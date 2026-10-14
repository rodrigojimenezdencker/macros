import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

function cameraError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se ha encontrado ninguna cámara.';
  if (!window.isSecureContext) return 'La cámara solo funciona con HTTPS.';
  return 'No se pudo abrir la cámara.';
}

/**
 * Scans EAN/UPC barcodes with the camera. Uses the native BarcodeDetector
 * (Chrome on Android) and falls back to ZXing (Safari/iOS, Firefox), which
 * is only downloaded when needed. A typed code works as a last resort.
 */
export function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  // Keep the latest callback without restarting the camera when it changes.
  const onDetectedRef = useRef(onDetected);
  useLayoutEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let zxingControls: { stop(): void } | undefined;

    const found = (code: string) => {
      if (done.current || cancelled) return;
      done.current = true;
      navigator.vibrate?.(60);
      onDetectedRef.current(code);
    };

    async function start() {
      const el = video.current;
      if (!el) return;
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera api'), { name: 'NotSupported' });
      const constraints: MediaStreamConstraints = {
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      const Native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      const nativeFormats = Native ? await Native.getSupportedFormats().catch(() => []) : [];
      if (Native && FORMATS.some((f) => nativeFormats.includes(f))) {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) return;
        el.srcObject = stream;
        await el.play();
        const detector = new Native({ formats: FORMATS.filter((f) => nativeFormats.includes(f)) });
        const tick = async () => {
          if (cancelled || done.current) return;
          try {
            const codes = await detector.detect(el);
            if (codes[0]?.rawValue) return found(codes[0].rawValue);
          } catch {
            // Frames can fail while the camera warms up; keep trying.
          }
          timer = setTimeout(tick, 150);
        };
        void tick();
        return;
      }

      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (cancelled) return;
      const hints = new Map([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      zxingControls = await reader.decodeFromConstraints(constraints, el, (result) => {
        if (result) found(result.getText());
      });
      if (cancelled) zxingControls.stop();
    }

    start().catch((err) => !cancelled && setError(cameraError(err)));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const code = manual.replace(/\D/g, '');

  return (
    <Sheet title="Escanear código de barras" onClose={onClose}>
      <div className="scanner">
        {error ? (
          <p className="scanner-error">{error}</p>
        ) : (
          <>
            <video ref={video} playsInline muted />
            <div className="scanner-frame" aria-hidden="true" />
          </>
        )}
      </div>
      <p className="muted small center">Centra el código de barras en el recuadro.</p>
      <form
        className="manual-code"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length >= 8) {
            done.current = true;
            onDetected(code);
          }
        }}
      >
        <label className="field">
          <span className="field-label">O escribe el número</span>
          <span className="field-input">
            <input inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="8412345678901" />
          </span>
        </label>
        <button className="btn" disabled={code.length < 8}>
          Buscar
        </button>
      </form>
    </Sheet>
  );
}
