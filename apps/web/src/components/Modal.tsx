import type { ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="panel-title">{title}</h3>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-200"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
