import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/library';
import { BarcodeDetectorPolyfill as BarcodeDetector } from '@undecaf/barcode-detector-polyfill';
import { Camera, Zap, History, ShieldCheck, Settings, X, Check, Info } from 'lucide-react';
import confetti from 'canvas-confetti';

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('Initialisation...');
  const [isReady, setIsReady] = useState(false);
  const [devices, setDevices] = useState([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [scanSpeed, setScanSpeed] = useState(150);
  const [logs, setLogs] = useState([{ msg: 'Initialisation du système...', type: 'info' }]);
  const [showPopup, setShowPopup] = useState(false);
  const [engine, setEngine] = useState('Google'); // 'Google' or 'ZXing'

  const addLog = (msg, type = 'info') => {
    setLogs(prev => [{ msg, type, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 15));
  };

  // Readers
  const zxingReader = useRef(null);
  const googleDetector = useRef(null);
  const lastScannedCode = useRef({ code: '', time: 0 });

  useEffect(() => {
    addLog('Démarrage de l\'application');

    // 1. Setup Google (Barcode Detector API)
    try {
      googleDetector.current = new BarcodeDetector({
        formats: ['code_128', 'qr_code', 'ean_13', 'code_39', 'itf', 'data_matrix']
      });
      addLog('Moteur Google Barcode API prêt', 'success');
    } catch (e) {
      addLog('Google Barcode API non supporté nativement, polyfill actif', 'info');
    }

    // 2. Setup ZXing Fallback
    const hints = new Map();
    hints.set(2, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13]);
    zxingReader.current = new BrowserMultiFormatReader(hints);

    setStatus('Ready');
    setIsReady(true);
    startDetectionLoop();
    setupCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const setupCamera = async (deviceId = '') => {
    try {
      setStatus('Connecting...');
      const availableDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = availableDevices.filter(d => d.kind === 'videoinput');
      setDevices(videoDevices);

      const constraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: 'continuous'
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      addLog('Caméra activée');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const currentTrack = stream.getVideoTracks()[0];
        if (currentTrack) {
          const settings = currentTrack.getSettings();
          setCurrentDeviceId(settings.deviceId);
          addLog(`${settings.width}x${settings.height} @ ${Math.round(settings.frameRate || 30)}fps`);
        }
      }
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        addLog('ACCÈS CAMÉRA REFUSÉ !', 'error');
      } else {
        addLog(`Erreur: ${err.message}`, 'error');
      }
      setStatus('Err: ' + err.message);
    }
  };

  const handleDeviceChange = (newDeviceId) => {
    addLog('Switch Caméra...');
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setCurrentDeviceId(newDeviceId);
    setupCamera(newDeviceId);
  };

  const startDetectionLoop = () => {
    let frameId;
    const processFrame = async () => {
      if (!videoRef.current || !isReady) {
        frameId = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          if (engine === 'Google') {
            const barcodes = await googleDetector.current.detect(video);
            if (barcodes.length > 0) {
              drawOverlay(barcodes);
              barcodes.forEach(b => handleSuccess(b.rawValue));
            } else {
              // Optionnel: fallback ZXing sur frame entière si Google ne voit rien
              // tryZXingFallback();
            }
          } else {
            // ZXing direct mode
            try {
              const result = await zxingReader.current.decodeFromVideoElement(video);
              if (result) handleSuccess(result.getText());
            } catch (e) {
              // No barcode found
            }
          }
        } catch (err) {
          // Detection error
        }
      }
      setTimeout(() => { if (isReady) frameId = requestAnimationFrame(processFrame); }, scanSpeed);
    };
    processFrame();
    return () => cancelAnimationFrame(frameId);
  };

  const drawOverlay = (barcodes) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    barcodes.forEach(barcode => {
      const { x, y, width, height } = barcode.boundingBox;

      // Box
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 6;
      ctx.strokeRect(x, y, width, height);

      // Label
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 24px Inter';
      ctx.fillText(barcode.format, x, y - 10);

      // Glowing effect
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#00ff88';
      ctx.strokeRect(x, y, width, height);
      ctx.shadowBlur = 0;
    });
  };

  const handleSuccess = (code) => {
    const now = Date.now();
    if (code === lastScannedCode.current.code && (now - lastScannedCode.current.time < 3000)) return;

    lastScannedCode.current = { code, time: now };
    setResults(prev => [{ code, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));

    addLog(`DÉTECTÉ (${engine}): ${code}`, 'success');
    setShowPopup(true);
    setTimeout(() => setShowPopup(false), 800);

    const appContainer = document.querySelector('.scanner-container');
    if (appContainer) {
      appContainer.classList.add('scan-success');
      setTimeout(() => appContainer.classList.remove('scan-success'), 200);
    }
    if (navigator.vibrate) navigator.vibrate(100);
    confetti({ particleCount: 60, spread: 90, origin: { y: 0.5 }, colors: ['#00ff88', '#ffffff'] });
  };

  return (
    <div className="scanner-container">
      <div className={`detection-popup ${showPopup ? 'active' : ''}`}>
        CODE {results[0]?.code.slice(0, 8)}...
      </div>

      <div className="video-container">
        <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="overlay-canvas" />
        <div className="scanner-crosshair" />
      </div>

      <div className="ui-layer">
        <header className="header">
          <h1>GOOGLE ML ENGINE</h1>
          <button className="icon-button" onClick={() => setShowSettings(true)}>
            <Settings size={24} color="#fff" />
          </button>
        </header>

        <div className="debug-console">
          {logs.map((log, i) => (
            <div key={i} className={`log-entry ${log.type}`}>
              [{log.time}] {log.msg}
            </div>
          ))}
        </div>

        <div className="results-list">
          {results.map((res, i) => (
            <div key={i} className="result-card">
              <span className="code">{res.code}</span>
              <span className="time">{res.time}</span>
            </div>
          ))}
        </div>

        {showSettings && (
          <div className="settings-drawer-overlay" onClick={() => setShowSettings(false)}>
            <div className="settings-drawer" onClick={e => e.stopPropagation()}>
              <div className="settings-header">
                <h2>Configuration Engine</h2>
                <button className="icon-button" onClick={() => setShowSettings(false)}>
                  <X size={24} color="#fff" />
                </button>
              </div>
              <div className="settings-content">
                <section className="settings-section">
                  <h3>Moteur de Scan</h3>
                  <div className="engine-toggle">
                    <button
                      className={`engine-btn ${engine === 'Google' ? 'active' : ''}`}
                      onClick={() => { setEngine('Google'); addLog('Moteur commuté sur Google'); }}
                    >
                      Google (ML Kit)
                    </button>
                    <button
                      className={`engine-btn ${engine === 'ZXing' ? 'active' : ''}`}
                      onClick={() => { setEngine('ZXing'); addLog('Moteur commuté sur ZXing'); }}
                    >
                      ZXing (Classic)
                    </button>
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Fréquence (Délai)</h3>
                  <div className="control-group">
                    <input
                      type="range" min="50" max="1000" step="50"
                      value={scanSpeed}
                      onChange={(e) => setScanSpeed(parseInt(e.target.value))}
                    />
                    <span className="control-value">{scanSpeed}ms</span>
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Choix Caméra</h3>
                  <div className="device-list">
                    {devices.map(device => (
                      <button
                        key={device.deviceId}
                        className={`device-item ${currentDeviceId === device.deviceId ? 'active' : ''}`}
                        onClick={() => handleDeviceChange(device.deviceId)}
                      >
                        <Camera size={18} />
                        <span className="device-label">{device.label || `Cam ${device.deviceId.slice(0, 5)}`}</span>
                        {currentDeviceId === device.deviceId && <Check size={18} color="#00ff88" />}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        <footer className="footer">
          <div className="status-badge">
            <div className={`status-dot ${status === 'Ready' ? '' : 'error'}`} />
            {engine} Mode
          </div>
          <Info size={24} color="#aaa" />
        </footer>
      </div>
    </div>
  );
}

export default App;
