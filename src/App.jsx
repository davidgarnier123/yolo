import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/library';
import * as ort from 'onnxruntime-web';
import { Camera, Zap, History, ShieldCheck, Settings, X, Check } from 'lucide-react';
import confetti from 'canvas-confetti';

const YOLO_INPUT_SIZE = 640;

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('Initialisation...');
  const [isReady, setIsReady] = useState(false);
  const [devices, setDevices] = useState([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [logs, setLogs] = useState([{ msg: 'Initialisation du système...', type: 'info' }]);
  const [showPopup, setShowPopup] = useState(false);

  const addLog = (msg, type = 'info') => {
    setLogs(prev => [{ msg, type, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 15));
  };

  // ZXing Reader for localized decoding
  const zxingReader = useRef(null);
  const lastScannedCode = useRef({ code: '', time: 0 });

  useEffect(() => {
    addLog('Démarrage de l\'application');
    // Initialize ZXing with Code 128 priority
    const hints = new Map();
    hints.set(2, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE]); // 2 is DecodeHintType.POSSIBLE_FORMATS
    zxingReader.current = new BrowserMultiFormatReader(hints);
    // Initialize Web Worker
    const worker = new Worker(new URL('./yoloWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'MODEL_LOADED') {
        setStatus('Ready');
        setIsReady(true);
        addLog('Modèle YOLO chargé avec succès !', 'success');
        startDetectionLoop();
      } else if (type === 'INFERENCE_RESULT') {
        handleDetections(payload);
      } else if (type === 'ERROR') {
        setStatus(`Error: ${payload}`);
        addLog(`ERREUR: ${payload}`, 'error');
      }
    };

    // Load Model
    worker.postMessage({
      type: 'LOAD_MODEL',
      payload: { modelUrl: window.location.origin + '/models/yolov8n-barcode.onnx' }
    });

    setupCamera();

    return () => {
      workerRef.current?.terminate();
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
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      addLog('Flux caméra activé');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const currentTrack = stream.getVideoTracks()[0];
        if (currentTrack) {
          const settings = currentTrack.getSettings();
          setCurrentDeviceId(settings.deviceId);
        }
      }
      const updatedDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(updatedDevices.filter(d => d.kind === 'videoinput'));
    } catch (err) {
      addLog(`Erreur Caméra: ${err.message}`, 'error');
      setStatus('Camera Error: ' + err.message);
    }
  };

  const handleDeviceChange = (newDeviceId) => {
    addLog('Changement de caméra...');
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setCurrentDeviceId(newDeviceId);
    setupCamera(newDeviceId);
  };

  const startDetectionLoop = () => {
    addLog('Boucle de détection lancée à 7 FPS');
    const processFrame = async () => {
      if (!videoRef.current || !isReady) {
        requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = YOLO_INPUT_SIZE;
        offscreenCanvas.height = YOLO_INPUT_SIZE;
        const ctx = offscreenCanvas.getContext('2d');
        ctx.drawImage(video, 0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);

        const imageData = ctx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
        const tensor = imageDataToTensor(imageData);

        workerRef.current.postMessage({
          type: 'FRAME',
          payload: {
            tensor,
            originalWidth: video.videoWidth,
            originalHeight: video.videoHeight
          }
        });
      }
      // Speed check for iOS battery (can be adjusted)
      setTimeout(() => requestAnimationFrame(processFrame), 140);
    };
    processFrame();
  };

  const imageDataToTensor = (imageData) => {
    const { data } = imageData;
    const [red, green, blue] = [
      new Float32Array(YOLO_INPUT_SIZE * YOLO_INPUT_SIZE),
      new Float32Array(YOLO_INPUT_SIZE * YOLO_INPUT_SIZE),
      new Float32Array(YOLO_INPUT_SIZE * YOLO_INPUT_SIZE)
    ];

    for (let i = 0; i < data.length; i += 4) {
      red[i / 4] = data[i] / 255.0;
      green[i / 4] = data[i + 1] / 255.0;
      blue[i / 4] = data[i + 2] / 255.0;
    }

    const inputData = new Float32Array(3 * YOLO_INPUT_SIZE * YOLO_INPUT_SIZE);
    inputData.set(red, 0);
    inputData.set(green, YOLO_INPUT_SIZE * YOLO_INPUT_SIZE);
    inputData.set(blue, 2 * YOLO_INPUT_SIZE * YOLO_INPUT_SIZE);

    return new ort.Tensor('float32', inputData, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
  };

  const handleDetections = async (payload) => {
    const { detections, originalWidth, originalHeight } = payload;
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;

    if (detections.length > 0) {
      // Optionnel: addLog(`Cible détectée (${detections.length})`, 'info');
    }

    canvas.width = originalWidth;
    canvas.height = originalHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    await Promise.all(detections.map(async (det) => {
      const { x, y, w, h, confidence } = det;

      // Visual feedback
      drawDetectionBox(ctx, x, y, w, h);
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 24px Inter';
      ctx.fillText(`${(confidence * 100).toFixed(0)}%`, x, y - 15);

      // Localized Decoding
      const code = await decodeROI(det);
      if (code) {
        handleSuccess(code, { x, y, w, h });
      }
    }));
  };

  const drawDetectionBox = (ctx, x, y, w, h) => {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 6; // Plus épais
    const len = Math.min(w, h) * 0.3;

    // Stylish corners
    ctx.beginPath(); ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + h - len); ctx.lineTo(x, y + h); ctx.lineTo(x + len, y + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - len, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - len); ctx.stroke();

    ctx.fillStyle = 'rgba(0, 255, 136, 0.2)';
    ctx.fillRect(x, y, w, h);
  };

  const decodeROI = async (det) => {
    const { x, y, w, h } = det;
    const video = videoRef.current;
    if (!video) return null;

    const padding = 40; // Plus de padding pour ZXing
    const bx = Math.max(0, x - padding);
    const by = Math.max(0, y - padding);
    const bw = Math.min(video.videoWidth - bx, w + padding * 2);
    const bh = Math.min(video.videoHeight - by, h + padding * 2);

    const roiCanvas = document.createElement('canvas');
    roiCanvas.width = bw;
    roiCanvas.height = bh;
    const roiCtx = roiCanvas.getContext('2d');
    roiCtx.drawImage(video, bx, by, bw, bh, 0, 0, bw, bh);

    try {
      const result = await zxingReader.current.decodeFromCanvas(roiCanvas);
      return result ? result.getText() : null;
    } catch (e) {
      return null;
    }
  };

  const handleSuccess = (code, box) => {
    const now = Date.now();
    if (code === lastScannedCode.current.code && (now - lastScannedCode.current.time < 3000)) return;

    lastScannedCode.current = { code, time: now };
    setResults(prev => [{ code, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));

    addLog(`DÉCODÉ : ${code}`, 'success');
    setShowPopup(true);
    setTimeout(() => setShowPopup(false), 800);

    // Feedback
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
        DETECTED!
      </div>

      <div className="video-container">
        <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="overlay-canvas" />
        <div className="scanner-crosshair" />
      </div>

      <div className="ui-layer">
        <header className="header">
          <h1>HYPER SCAN PRO</h1>
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
                <h2>Settings</h2>
                <button className="icon-button" onClick={() => setShowSettings(false)}>
                  <X size={24} color="#fff" />
                </button>
              </div>
              <div className="settings-content">
                <section className="settings-section">
                  <h3>Select Camera</h3>
                  <div className="device-list">
                    {devices.map(device => (
                      <button
                        key={device.deviceId}
                        className={`device-item ${currentDeviceId === device.deviceId ? 'active' : ''}`}
                        onClick={() => handleDeviceChange(device.deviceId)}
                      >
                        <Camera size={18} />
                        <span className="device-label">{device.label || `Camera ${device.deviceId.slice(0, 5)}...`}</span>
                        {currentDeviceId === device.deviceId && <Check size={18} color="#00ff88" />}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="settings-section">
                  <h3>Engine</h3>
                  <p className="version-text">Hybrid YOLOv8 + ZXing Engine</p>
                  <p className="version-text">Version 2.0.0 (Robust iOS)</p>
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
