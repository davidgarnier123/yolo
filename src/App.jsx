import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';
import { Camera, Zap, History, ShieldCheck, Settings, X, Check } from 'lucide-react';
import confetti from 'canvas-confetti';

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('Initializing...');
  const [isReady, setIsReady] = useState(false);
  const [devices, setDevices] = useState([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // ZXing Reader
  const zxingReader = useRef(null);
  const lastScannedCode = useRef({ code: '', time: 0 });

  useEffect(() => {
    // Initialize ZXing with hints for better performance
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.CODE_39
    ]);

    zxingReader.current = new BrowserMultiFormatReader(hints);

    setupCamera();

    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
      if (zxingReader.current) {
        zxingReader.current.reset();
      }
    };
  }, []);

  const setupCamera = async (deviceId = '') => {
    try {
      setStatus('Connecting to camera...');

      const availableDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = availableDevices.filter(d => d.kind === 'videoinput');
      setDevices(videoDevices);

      const constraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const currentTrack = stream.getVideoTracks()[0];
        if (currentTrack) {
          const settings = currentTrack.getSettings();
          setCurrentDeviceId(settings.deviceId);
        }

        // Start scanning once video is ready
        videoRef.current.onloadedmetadata = () => {
          setStatus('Ready');
          setIsReady(true);
          startScanning();
        };
      }

      const updatedDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(updatedDevices.filter(d => d.kind === 'videoinput'));

    } catch (err) {
      console.error('Camera Error:', err);
      setStatus('Camera Error: ' + err.message);
    }
  };

  const handleDeviceChange = (newDeviceId) => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    if (zxingReader.current) {
      zxingReader.current.reset();
    }
    setCurrentDeviceId(newDeviceId);
    setupCamera(newDeviceId);
  };

  const startScanning = async () => {
    if (!videoRef.current || !zxingReader.current) return;

    try {
      await zxingReader.current.decodeFromVideoElement(videoRef.current, (result, error) => {
        if (result) {
          const code = result.getText();
          const points = result.getResultPoints();

          // Draw detection UI
          drawResultPoints(points);

          handleSuccess(code);
        }

        // Clean canvas if no detection (optional, but keeps it tidy)
        if (error && !result) {
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
      });
    } catch (err) {
      console.error('Scan Error:', err);
    }
  };

  const drawResultPoints = (points) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !points || points.length < 2) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate bounding box from points
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    const w = maxX - minX;
    const h = maxY - minY;
    const padding = 20;

    // Draw HUD Box
    drawHUDBox(ctx, minX - padding, minY - padding, w + padding * 2, h + padding * 2);
  };

  const drawHUDBox = (ctx, x, y, w, h) => {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;
    const len = Math.min(w, h) * 0.2;

    // Corners
    ctx.beginPath(); ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len); ctx.stroke();

    ctx.fillStyle = 'rgba(0, 255, 136, 0.1)';
    ctx.fillRect(x, y, w, h);
  };

  const handleSuccess = (code) => {
    const now = Date.now();
    if (code === lastScannedCode.current.code && (now - lastScannedCode.current.time < 3000)) return;

    lastScannedCode.current = { code, time: now };
    setResults(prev => [{ code, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));

    // Feedback
    const appContainer = document.querySelector('.scanner-container');
    if (appContainer) {
      appContainer.classList.add('scan-success');
      setTimeout(() => appContainer.classList.remove('scan-success'), 200);
    }
    if (navigator.vibrate) navigator.vibrate(50);

    confetti({
      particleCount: 40, spread: 70, origin: { y: 0.6 }, colors: ['#00ff88', '#ffffff']
    });
  };

  return (
    <div className="scanner-container">
      <div className="video-container">
        <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="overlay-canvas" />
        <div className="scanner-crosshair" />
      </div>

      <div className="ui-layer">
        <header className="header">
          <h1>AI HYPER SCAN</h1>
          <button className="icon-button" onClick={() => setShowSettings(true)} style={{ pointerEvents: 'auto' }}>
            <Settings size={24} color="#fff" />
          </button>
        </header>

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
                <h2>Settings</h2>
                <button className="icon-button" onClick={() => setShowSettings(false)}>
                  <X size={24} color="#fff" />
                </button>
              </div>

              <div className="settings-content">
                <section className="settings-section">
                  <h3>Select Camera</h3>
                  <div className="device-list">
                    {devices.length === 0 ? (
                      <p className="empty-text">No cameras found or access denied.</p>
                    ) : (
                      devices.map(device => (
                        <button
                          key={device.deviceId}
                          className={`device-item ${currentDeviceId === device.deviceId ? 'active' : ''}`}
                          onClick={() => handleDeviceChange(device.deviceId)}
                        >
                          <Camera size={18} />
                          <span className="device-label">{device.label || `Camera ${device.deviceId.slice(0, 5)}...`}</span>
                          {currentDeviceId === device.deviceId && <Check size={18} color="#00ff88" />}
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="settings-section">
                  <h3>About</h3>
                  <p className="version-text">Version 1.5.0 - AI Barcode Scanner</p>
                </section>
              </div>
            </div>
          </div>
        )}

        <footer className="footer">
          <div className="status-badge">
            <div className={`status-dot ${status === 'Ready' ? '' : 'error'}`} />
            {status}
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <History size={24} color="#aaa" />
            <ShieldCheck size={24} color="#aaa" />
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
