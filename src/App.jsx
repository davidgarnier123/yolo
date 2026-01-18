import React, { useEffect, useRef, useState } from 'react';
import { BarcodeDetectorPolyfill as BarcodeDetector } from '@undecaf/barcode-detector-polyfill';
import { Camera, RefreshCw, AlertCircle } from 'lucide-react';

export default function App() {
  const videoRef = useRef(null);
  const [result, setResult] = useState('Prêt pour scan');
  const [logs, setLogs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [isInitializing, setIsInitializing] = useState(false);

  const addLog = (msg) => setLogs(p => [`${new Date().toLocaleTimeString()}: ${msg}`, ...p].slice(0, 10));

  const initCamera = async (specificId = '') => {
    if (isInitializing) return;
    setIsInitializing(true);
    addLog("Initialisation caméra...");

    try {
      // 1. Demander une permission générique pour débloquer les labels
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }

      const constraints = specificId
        ? { video: { deviceId: { exact: specificId }, width: { ideal: 1280 }, height: { ideal: 720 } } }
        : { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // 2. Énumérer les appareils maintenant que la permission est acquise
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = allDevices.filter(d => d.kind === 'videoinput');
      setDevices(videoDevs);

      // Trouver l'ID actif réel
      const activeTrack = stream.getVideoTracks()[0];
      const settings = activeTrack.getSettings();
      setActiveDeviceId(settings.deviceId);

      addLog(`Caméra OK: ${settings.width}x${settings.height}`);
    } catch (e) {
      addLog("ERREUR: " + e.message);
      console.error(e);
    } finally {
      setIsInitializing(false);
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
    const detector = new BarcodeDetector();
    let frameId;

    const detect = async () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            setResult(code);
            addLog("SCOPÉ: " + code);
            if (navigator.vibrate) navigator.vibrate(100);
          }
        } catch (e) {
          // Detection fail (no barcode in frame)
        }
      }
      frameId = setTimeout(() => requestAnimationFrame(detect), 200);
    };

    detect();
    return () => clearTimeout(frameId);
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#fff', fontFamily: 'system-ui' }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        autoPlay playsInline muted
      />

      {/* Overlay UI */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 20, background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem', letterSpacing: 2, color: '#0f8' }}>ENGINE V3.0</h1>
        <div style={{ background: '#000', margin: '15px 0', padding: 10, borderRadius: 8, border: '1px solid #333', fontSize: '1.4rem', color: '#fff', wordBreak: 'break-all' }}>
          {result}
        </div>
      </div>

      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '280px', height: '180px', border: '2px solid #0f8', borderRadius: 20, boxShadow: '0 0 20px rgba(0,255,136,0.3)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '50%', width: '100%', height: '2px', background: 'rgba(0,255,136,0.5)', boxShadow: '0 0 10px #0f8', animation: 'scan 2s infinite linear' }} />
      </div>

      {/* Controls */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)' }}>
        <div style={{ marginBottom: 15, display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 10 }}>
          {devices.map((dev, idx) => (
            <button
              key={dev.deviceId}
              onClick={() => initCamera(dev.deviceId)}
              style={{
                flexShrink: 0, background: activeDeviceId === dev.deviceId ? '#0f8' : '#333',
                color: activeDeviceId === dev.deviceId ? '#000' : '#fff',
                border: 'none', padding: '10px 15px', borderRadius: 8, fontSize: '0.8rem',
                fontWeight: 'bold', cursor: 'pointer'
              }}
            >
              {dev.label || `Caméra ${idx + 1}`}
            </button>
          ))}
          {devices.length === 0 && (
            <button onClick={() => initCamera()} style={{ background: '#0f8', color: '#000', padding: '10px 20px', borderRadius: 8, border: 'none', fontWeight: 'bold' }}>
              Forcer Détection Caméras
            </button>
          )}
        </div>

        <div style={{ maxHeight: '100px', overflowY: 'auto', fontSize: '0.7rem', color: '#888' }}>
          {logs.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 10%; }
          50% { top: 90%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  );
}
