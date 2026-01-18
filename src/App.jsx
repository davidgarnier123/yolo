import React, { useEffect, useRef, useState } from 'react';
import { BarcodeDetectorPolyfill as BarcodeDetector } from '@undecaf/barcode-detector-polyfill';
import { Camera, Settings, History, Info, Check, RefreshCw, Zap } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [results, setResults] = useState([]);
  const [logs, setLogs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState('Prêt');
  const [scanSpeed, setScanSpeed] = useState(150);
  const [showPopup, setShowPopup] = useState(false);
  const lastScannedCode = useRef({ code: '', time: 0 });

  const addLog = (msg, type = 'info') => {
    setLogs(p => [{ msg, type, time: new Date().toLocaleTimeString() }, ...p].slice(0, 15));
  };

  const initCamera = async (specificId = '') => {
    try {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        video: {
          deviceId: specificId ? { exact: specificId } : undefined,
          facingMode: specificId ? undefined : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) videoRef.current.srcObject = stream;

      const devs = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = devs.filter(d => d.kind === 'videoinput');
      setDevices(videoDevs);

      const settings = stream.getVideoTracks()[0].getSettings();
      setActiveDeviceId(settings.deviceId);
      addLog(`Caméra OK: ${settings.width}x${settings.height}`, 'success');
    } catch (e) {
      addLog(`Erreur: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    initCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    // Narrowing formats to increase speed and robustness for Code 128
    const detector = new BarcodeDetector({
      formats: ['code_128', 'qr_code', 'ean_13']
    });
    let frameId;
    let lastProcessedTime = 0;

    const detect = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      const now = Date.now();
      if (video && video.readyState >= 2 && canvas && (now - lastProcessedTime >= scanSpeed)) {
        lastProcessedTime = now;
        try {
          const barcodes = await detector.detect(video);

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          if (barcodes.length > 0) {
            barcodes.forEach(barcode => {
              drawBarcodeOverlay(ctx, barcode);
              handleSuccess(barcode.rawValue);
            });
          }
        } catch (e) {
          // ignore
        }
      }
      frameId = requestAnimationFrame(detect);
    };

    detect();
    return () => cancelAnimationFrame(frameId);
  }, [scanSpeed]);

  const drawBarcodeOverlay = (ctx, barcode) => {
    const { x, y, width, height } = barcode.boundingBox;
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';

    // Corners
    const len = Math.min(width, height) * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + width - len, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + len);
    ctx.moveTo(x + width, y + height - len); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - len, y + height);
    ctx.moveTo(x + len, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - len);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 255, 136, 0.2)';
    ctx.fillRect(x, y, width, height);
  };

  const handleSuccess = (code) => {
    const now = Date.now();
    if (code === lastScannedCode.current.code && (now - lastScannedCode.current.time < 3000)) return;

    lastScannedCode.current = { code, time: now };
    setResults(prev => [{ code, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));

    addLog(`SUCCÈS: ${code}`, 'success');
    setShowPopup(true);
    setTimeout(() => setShowPopup(false), 1000);

    if (navigator.vibrate) navigator.vibrate(100);
    confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 }, colors: ['#00ff88', '#ffffff'] });
  };

  return (
    <div className="scanner-container">
      <div className={`detection-popup ${showPopup ? 'active' : ''}`}>
        DÉTECTÉ !
      </div>

      <div className="video-container">
        <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="overlay-canvas" />
        <div className="scanner-crosshair" />
        <div className="scanning-line" />
      </div>

      <div className="ui-layer">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>HYPER ENGINE V4</h1>
            <button className="icon-button" onClick={() => initCamera(activeDeviceId)} title="Redémarrer Caméra">
              <RefreshCw size={18} color="#0f8" />
            </button>
          </div>
          <button className="icon-button" onClick={() => setShowSettings(true)}>
            <Settings size={22} color="#fff" />
          </button>
        </header>

        <div className="debug-console">
          <div className="log-entry info" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 5, marginBottom: 5, fontWeight: 'bold' }}>
            STATUT: {status === 'Prêt' ? 'ACTIVE' : status} | MOTEUR: GOOGLE (WASM)
          </div>
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
                <h2>Réglages Avancés</h2>
                <button className="icon-button" onClick={() => setShowSettings(false)}>
                  <RefreshCw size={22} color="#fff" />
                </button>
              </div>
              <div className="settings-content">
                <section className="settings-section">
                  <h3>Fluidité (Scan Speed)</h3>
                  <div className="control-group">
                    <input
                      type="range" min="50" max="500" step="50"
                      value={scanSpeed}
                      onChange={(e) => setScanSpeed(parseInt(e.target.value))}
                    />
                    <span className="control-value">{scanSpeed}ms</span>
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Sélection Caméra</h3>
                  <div className="device-list">
                    {devices.map(device => (
                      <button
                        key={device.deviceId}
                        className={`device-item ${activeDeviceId === device.deviceId ? 'active' : ''}`}
                        onClick={() => initCamera(device.deviceId)}
                      >
                        <Camera size={18} />
                        <span className="device-label">{device.label || `Caméra ${device.deviceId.slice(0, 5)}`}</span>
                        {activeDeviceId === device.deviceId && <Check size={18} color="#00ff88" />}
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
            <div className="status-dot" />
            OMNIDIRECTIONAL
          </div>
          <Zap size={20} color="#0f8" />
        </footer>
      </div>
    </div>
  );
}
