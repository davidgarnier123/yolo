import React, { useEffect, useRef, useState } from 'react';
import { BarcodeDetectorPolyfill as BarcodeDetector } from '@undecaf/barcode-detector-polyfill';
import { Camera, RefreshCw } from 'lucide-react';

export default function App() {
  const videoRef = useRef(null);
  const [result, setResult] = useState('En attente...');
  const [logs, setLogs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceIndex, setDeviceIndex] = useState(0);

  const addLog = (msg) => setLogs(p => [msg, ...p].slice(0, 5));

  useEffect(() => {
    const startCamera = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devs.filter(d => d.kind === 'videoinput');
        setDevices(videoDevs);

        if (videoDevs.length === 0) {
          addLog("Aucune caméra trouvée");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: videoDevs[deviceIndex]?.deviceId,
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (videoRef.current) videoRef.current.srcObject = stream;
        addLog("Caméra démarrée");
      } catch (e) {
        addLog("Erreur caméra: " + e.message);
      }
    };

    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, [deviceIndex]);

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
            addLog("DETECTÉ: " + code);
            if (navigator.vibrate) navigator.vibrate(200);
          }
        } catch (e) {
          // ignore
        }
      }
      frameId = setTimeout(() => requestAnimationFrame(detect), 200);
    };

    detect();
    return () => clearTimeout(frameId);
  }, []);

  const nextCamera = () => {
    setDeviceIndex((deviceIndex + 1) % devices.length);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', fontFamily: 'sans-serif' }}>
      <video
        ref={videoRef}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        autoPlay
        playsInline
        muted
      />

      <div style={{ position: 'absolute', top: 20, left: 20, right: 20, background: 'rgba(0,0,0,0.7)', padding: 15, borderRadius: 10, textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#0f8' }}>Scanner Minimaliste</h2>
        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '10px 0', wordBreak: 'break-all' }}>{result}</div>
      </div>

      <div style={{ position: 'absolute', bottom: 100, left: 20, right: 20, pointerEvents: 'none' }}>
        {logs.map((log, i) => (
          <div key={i} style={{ fontSize: '0.8rem', opacity: 0.7 }}>{log}</div>
        ))}
      </div>

      <button
        onClick={nextCamera}
        style={{
          position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
          background: '#0f8', color: '#000', border: 'none', padding: '15px 30px',
          borderRadius: 50, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 10
        }}
      >
        <RefreshCw size={20} />
        Changer Caméra ({deviceIndex + 1}/{devices.length})
      </button>

      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '70vw', height: '30vh', border: '2px dashed #0f8', borderRadius: 20, pointerEvents: 'none' }} />
    </div>
  );
}
