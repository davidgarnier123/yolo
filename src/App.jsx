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
  const [threshold, setThreshold] = useState(0.25);
  const [scanSpeed, setScanSpeed] = useState(150); // ms between frames
  const [logs, setLogs] = useState([{ msg: 'Initialisation du système...', type: 'info' }]);
  const [showPopup, setShowPopup] = useState(false);

  const addLog = (msg, type = 'info') => {
    setLogs(prev => [{ msg, type, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 15));
  };

  useEffect(() => {
    addLog('Démarrage de l\'application');
    // Initialize ZXing with all common formats for broad compatibility
    const hints = new Map();
    hints.set(2, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.EAN_13,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF
    ]);
    zxingReader.current = new BrowserMultiFormatReader(hints);

    // Initialize Web Worker
    const worker = new Worker(new URL('./yoloWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'MODEL_LOADED') {
        setStatus('Ready');
        setIsReady(true);
        addLog('Modèle YOLO chargé !', 'success');
        startDetectionLoop();
      } else if (type === 'INFERENCE_RESULT') {
        handleDetections(payload);
      } else if (type === 'LOG') {
        addLog(payload.msg, payload.type);
      } else if (type === 'ERROR') {
        setStatus(`Error`);
        addLog(`ERREUR WORKER: ${payload.msg || payload}`, 'error');
      }
    };

    // Load Model with absolute URL
    worker.postMessage({
      type: 'LOAD_MODEL',
      payload: {
        modelUrl: window.location.origin + '/models/yolov8n-barcode.onnx'
      }
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
          height: { ideal: 720 },
          focusMode: 'continuous' // Try to force autofocus
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      addLog('Caméra OK');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        const currentTrack = stream.getVideoTracks()[0];
        if (currentTrack) {
          const settings = currentTrack.getSettings();
          setCurrentDeviceId(settings.deviceId);
          addLog(`Résolution: ${settings.width}x${settings.height}`);
        }
      }
    } catch (err) {
      addLog(`Erreur Caméra: ${err.message}`, 'error');
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
            originalHeight: video.videoHeight,
            threshold // Dynamic threshold
          }
        });
      }
      setTimeout(() => { if (isReady) frameId = requestAnimationFrame(processFrame); }, scanSpeed);
    };
    processFrame();
    return () => cancelAnimationFrame(frameId);
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
    const { detections, width, height } = payload;
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detections.length > 0) {
      addLog(`IA: ${detections.length} objet(s) trouvé(s)`, 'info');
    }

    for (const det of detections) {
      const { x, y, w, h, confidence } = det;
      drawDetectionBox(ctx, x, y, w, h);

      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 24px Inter';
      ctx.fillText(`${(confidence * 100).toFixed(0)}%`, x, y - 15);

      const code = await decodeROI(det);
      if (code) {
        handleSuccess(code, det);
      }
    }
  };

  const drawDetectionBox = (ctx, x, y, w, h) => {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 6;
    const len = Math.min(w, h) * 0.3;

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

    const padding = 50;
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

  const handleSuccess = (code) => {
    const now = Date.now();
    if (code === lastScannedCode.current.code && (now - lastScannedCode.current.time < 3000)) return;

    lastScannedCode.current = { code, time: now };
    setResults(prev => [{ code, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));

    addLog(`SUCCÈS : ${code}`, 'success');
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
        SUCCESS!
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
                <h2>Tuning & Options</h2>
                <button className="icon-button" onClick={() => setShowSettings(false)}>
                  <X size={24} color="#fff" />
                </button>
              </div>
              <div className="settings-content">
                <section className="settings-section">
                  <h3>Sensibilité (Inférence)</h3>
                  <div className="control-group">
                    <input
                      type="range" min="0.05" max="0.8" step="0.05"
                      value={threshold}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setThreshold(val);
                        addLog(`Seuil réglé à ${val}`);
                      }}
                    />
                    <span className="control-value">{(threshold * 100).toFixed(0)}%</span>
                  </div>
                </section>

                <section className="settings-section">
                  <h3>Vitesse du scan</h3>
                  <div className="control-group">
                    <input
                      type="range" min="50" max="500" step="50"
                      value={scanSpeed}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setScanSpeed(val);
                        addLog(`FPS limit: ${Math.round(1000 / val)}/s`);
                      }}
                    />
                    <span className="control-value">{scanSpeed}ms</span>
                  </div>
                </section>

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
            {status}
          </div>
          <History size={24} color="#aaa" />
        </footer>
      </div>
    </div>
  );
}

export default App;
