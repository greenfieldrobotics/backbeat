import { useEffect, useRef, useState } from 'react';
import { getCameraScanSupport } from './cameraSupport';
import { createCameraBarcodeDetector } from './zxingDecoder';

interface Props {
  onDetect: (rawValue: string) => void;
}

type Status = 'insecure-context' | 'no-camera-api' | 'starting' | 'scanning' | 'camera-error';

// Camera-based scanning (G4.1). Decodes QR/DataMatrix from a live camera feed using the
// self-hosted ZXing-wasm decoder (see zxingDecoder.ts) so behaviour is identical on
// Chrome/Android and iOS Safari, neither of which is assumed to have a working native
// BarcodeDetector. `getUserMedia` requires a secure context, so an insecure page (e.g. a
// phone on the LAN hitting the plain-HTTP dev server) gets an explicit message instead of
// an opaque permission failure (§6.3).
export default function CameraBarcodeScanner({ onDetect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  useEffect(() => {
    const support = getCameraScanSupport();
    if (!support.ready) {
      setStatus(support.reason);
      return;
    }

    let stopped = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    const detector = createCameraBarcodeDetector();

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(mediaStream => {
        if (stopped) {
          mediaStream.getTracks().forEach(t => t.stop());
          return;
        }
        stream = mediaStream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = mediaStream;
          video.play().catch(() => {});
        }
        setStatus('scanning');

        const tick = () => {
          if (stopped) return;
          const currentVideo = videoRef.current;
          if (currentVideo && currentVideo.readyState >= currentVideo.HAVE_CURRENT_DATA) {
            detector
              .detect(currentVideo)
              .then(barcodes => {
                if (stopped) return;
                if (barcodes.length > 0) {
                  onDetectRef.current(barcodes[0].rawValue);
                  return;
                }
                rafId = requestAnimationFrame(tick);
              })
              .catch(() => {
                // A frame mid-decode occasionally throws (e.g. zero-size frame while the
                // camera warms up) — not a reason to stop scanning.
                if (!stopped) rafId = requestAnimationFrame(tick);
              });
          } else {
            rafId = requestAnimationFrame(tick);
          }
        };
        rafId = requestAnimationFrame(tick);
      })
      .catch(err => {
        if (stopped) return;
        setStatus('camera-error');
        setErrorMessage(err instanceof Error ? err.message : 'Camera unavailable');
      });

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  if (status === 'insecure-context') {
    return (
      <p className="alert alert-error">
        Camera scanning needs a secure connection (HTTPS). This page was loaded over an
        insecure connection, so the browser won't allow camera access here.
      </p>
    );
  }
  if (status === 'no-camera-api') {
    return (
      <p className="alert alert-error">
        This browser doesn't support camera access. Use a dedicated scanner instead.
      </p>
    );
  }
  if (status === 'camera-error') {
    return (
      <p className="alert alert-error">
        Couldn't access the camera{errorMessage ? `: ${errorMessage}` : '.'}
      </p>
    );
  }

  return (
    <div className="camera-scanner">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- live camera preview, not media playback */}
      <video ref={videoRef} muted playsInline style={{ width: '100%', maxWidth: 480 }} />
      {status === 'starting' && <p>Starting camera…</p>}
    </div>
  );
}
