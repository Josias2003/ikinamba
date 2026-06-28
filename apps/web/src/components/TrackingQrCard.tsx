export function TrackingQrCard({ token, caption }: { token: string; caption?: string }) {
  const link = `${location.origin}/track/${token}`;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <img src={`/api/track/${token}/qrcode.png`} alt="Tracking QR code" width={200} height={200} className="bg-white rounded-sm p-2" />
      <div className="space-y-1">
        {caption && <p className="text-sm text-ink-200">{caption}</p>}
        <a href={link} target="_blank" rel="noreferrer" className="text-xs font-mono text-brand-400 hover:underline break-all">
          {link}
        </a>
      </div>
      <span className="badge-live"><span className="status-dot-live" /> Live tracking</span>
    </div>
  );
}
