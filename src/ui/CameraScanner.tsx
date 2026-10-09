// Lecture de QR codes par la caméra (F-51). Le module de décodage (WebAssembly) est servi
// par l'application elle-même : aucune requête vers un service tiers.
import { useEffect, useRef, useState } from 'react';
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

const SCAN_INTERVAL_MS = 200;

export function CameraScanner({ onCode, paused = false }: { onCode: (code: string) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(paused);
  const [error, setError] = useState('');
  onCodeRef.current = onCode;
  pausedRef.current = paused;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    const loop = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      if (!pausedRef.current && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue?.trim();
          if (value) onCodeRef.current(value);
        } catch { /* image illisible : on réessaie au tour suivant */ }
      }
      timer = setTimeout(loop, SCAN_INTERVAL_MS);
    };

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const video = videoRef.current!;
        video.srcObject = s;
        return video.play().then(loop);
      })
      .catch(() => setError("Impossible d'accéder à la caméra : vérifiez l'autorisation dans le navigateur. Une connexion sécurisée (HTTPS) est nécessaire sur téléphone."));

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <p role="alert" className="notice notice-danger">{error}</p>;
  return (
    <video ref={videoRef} muted playsInline aria-label="Image de la caméra"
      style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 12, background: '#000', display: 'block' }} />
  );
}
