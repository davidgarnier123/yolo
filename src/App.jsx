import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/library';
import * as ort from 'onnxruntime-web';
import { Camera, Zap, History, ShieldCheck } from 'lucide-react';
import confetti from 'canvas-confetti';

const YOLO_INPUT_SIZE = 640;

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('Initializing...');
  const [isReady, setIsReady] = useState(false);

  // ZXing Reader for localized decoding
  const zxingReader = useRef(new BrowserMultiFormatReader());
  const lastScannedCode = useRef({ code: '', time: 0 });

  useEffect(() => {
    // Initialize Web Worker
    workerRef.current = new Worker(new URL('./yoloWorker.js', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'MODEL_LOADED') {
        setStatus('Ready');
        setIsReady(true);
        startDetectionLoop();
      } else if (type === 'INFERENCE_RESULT') {
        handleDetections(payload);
      } else if (type === 'ERROR') {
        setStatus(`Error: ${payload}`);
      }
    };

    // Load Model (Placeholder URL - User should provide a real YOLOv8 barcode ONNX model)
    // For demo purposes, we'll try to load a generic one or explain
    workerRef.current.postMessage({
      type: 'LOAD_MODEL',
      payload: { modelUrl: window.location.origin + '/models/yolov8n-barcode.onnx' }
    });

    setupCamera();

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const setupCamera = async () => {
    try {
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      console.log('Camera stream obtained.');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera Error:', err);
      setStatus('Camera Error: ' + err.message);
    }
  };

  const startDetectionLoop = () => {
    const processFrame = async () => {
      if (!videoRef.current || !isReady) return;

      const video = videoRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Capture frame
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = YOLO_INPUT_SIZE;
        offscreenCanvas.height = YOLO_INPUT_SIZE;
        const ctx = offscreenCanvas.getContext('2d');
        ctx.drawImage(video, 0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);

        const imageData = ctx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
        const tensor = preprocess(imageData);

        workerRef.current.postMessage({
          type: 'INFER',
          payload: {
            tensor,
            originalWidth: video.videoWidth,
            originalHeight: video.videoHeight
          }
        });
      }
      setTimeout(processFrame, 150); // ~7 FPS detection for battery/performance
    };
    processFrame();
  };

  const preprocess = (imageData) => {
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

  const handleDetections = async (detections) => {
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;

    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Process all detections in parallel for speed
    await Promise.all(detections.map(async (det) => {
      const { box, confidence } = det;
      const [x, y, w, h] = box;

      // Draw stylized box (neon corners)
      drawDetectionBox(ctx, x, y, w, h);

      // Label with confidence
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 14px Inter';
      ctx.fillText(`Scanner (${(confidence * 100).toFixed(0)}%)`, x, y - 10);

      // Targeted Decoding
      const code = await decodeROI(det);
      if (code) {
        // Draw the code string with a background for readability
        ctx.font = 'bold 18px Inter';
        const textWidth = ctx.measureText(code).width;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.roundRect(x, y + h + 5, textWidth + 20, 30, 8);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(code, x + 10, y + h + 27);

        // Success feedback
        handleSuccess(code);
      }
    }));
  };

  const drawDetectionBox = (ctx, x, y, w, h) => {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 3;

    // Draw corners instead of a full rectangle for a premium feel
    const len = Math.min(w, h) * 0.2;

    // Top Left
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();

    // Top Right
    ctx.beginPath();
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    ctx.stroke();

    // Bottom Left
    ctx.beginPath();
    ctx.moveTo(x, y + h - len);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + len, y + h);
    ctx.stroke();

    // Bottom Right
    ctx.beginPath();
    ctx.moveTo(x + w - len, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - len);
    ctx.stroke();

    // Semi-transparent center fill
    ctx.fillStyle = 'rgba(0, 255, 136, 0.1)';
    ctx.fillRect(x, y, w, h);
  };

  const decodeROI = async (det) => {
    const { box } = det;
    const [x, y, w, h] = box;
    const video = videoRef.current;
    if (!video) return null;

    // Buffer region slightly for better decoding
    const padding = 30;
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
    // Prevent duplicates (3 second cooldown)
    const now = Date.now();
    if (code === lastScannedCode.current.code && (now - lastScannedCode.current.time < 3000)) {
      return;
    }

    lastScannedCode.current = { code, time: now };
    setResults(prev => [{ code, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));

    // UI Feedback Flash
    const appContainer = document.querySelector('.scanner-container');
    if (appContainer) {
      appContainer.classList.add('scan-success');
      setTimeout(() => appContainer.classList.remove('scan-success'), 200);
    }

    // Haptic Feedback
    if (navigator.vibrate) navigator.vibrate(50);

    // Visual Feedback
    confetti({
      particleCount: 40,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#00ff88', '#ffffff']
    });
  };

  return (
    <div className="scanner-container">
      <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="overlay-canvas" />

      <div className="scanner-crosshair" />

      <div className="ui-layer">
        <header className="header">
          <h1>AI HYPER SCAN</h1>
        </header>

        <div className="results-list">
          {results.map((res, i) => (
            <div key={i} className="result-card">
              <span className="code">{res.code}</span>
              <span className="time">{res.time}</span>
            </div>
          ))}
        </div>

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
