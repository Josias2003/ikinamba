import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

const ELEMENT_ID = "qr-scanner-viewport";

/** Camera-based QR scanner for staff actions (e.g. scan-to-pickup). Decodes the URL
 * encoded in the customer's tracking QR and hands the raw token back to the caller. */
export function QrScanner({ onToken, onError }: { onToken: (token: string) => void; onError?: (msg: string) => void }) {
  // Callbacks are read through refs, not effect deps -- callers (e.g. QueueBoard, which
  // re-renders on every live socket update) typically pass new inline function instances
  // each render. Depending on them directly would tear down and restart the camera on
  // every parent re-render while the scanner is open.
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
  }, [onToken, onError]);

  useEffect(() => {
    const scanner = new Html5Qrcode(ELEMENT_ID);
    let cancelled = false;

    const startPromise = scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 220 },
      (decodedText) => {
        if (cancelled) return;
        const match = decodedText.match(/\/track\/([a-f0-9]+)/i);
        if (match) onTokenRef.current(match[1]);
      },
      undefined
    );

    startPromise
      .then(() => {
        // React StrictMode mounts/cleans-up/remounts once in dev -- if cleanup already
        // ran by the time start() actually resolves, the camera would otherwise be left
        // running with nothing left to stop it.
        if (cancelled) scanner.stop().catch(() => {}).finally(() => scanner.clear());
      })
      .catch((err) => {
        if (!cancelled) onErrorRef.current?.(err instanceof Error ? err.message : "Could not access camera");
      });

    return () => {
      cancelled = true;
      // Only stop a scanner that actually finished starting -- calling stop() while
      // start() is still pending is what throws inside html5-qrcode under StrictMode's
      // immediate mount/unmount/remount cycle.
      if (scanner.isScanning) {
        scanner.stop().catch(() => {}).finally(() => scanner.clear());
      }
    };
  }, []);

  return <div id={ELEMENT_ID} className="rounded-sm overflow-hidden" />;
}
