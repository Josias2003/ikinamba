import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { api } from "../lib/api";
import { Modal } from "../components/Modal";
import { TrackingQrCard } from "../components/TrackingQrCard";

interface Appt {
  id: string; scheduledAt: string; status: string; source: string;
  customer: { name: string; phone: string }; vehicle: { make: string; model: string; plate: string };
  serviceItems: { catalogItem: { name: string } }[];
}

interface QueueEntry { trackingToken: string }

export function Appointments() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [qrToken, setQrToken] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["appointments", date],
    queryFn: () => api.get<Appt[]>(`/appointments?date=${date}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["appointments", date] });
  const checkIn = useMutation({
    mutationFn: (id: string) => api.post<QueueEntry>(`/appointments/${id}/check-in`),
    onSuccess: (entry) => { refresh(); setQrToken(entry.trackingToken); },
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.patch(`/appointments/${id}/cancel`), onSuccess: refresh });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <input className="input max-w-xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {qrToken && (
        <Modal title="Customer tracking QR" onClose={() => setQrToken(null)}>
          <TrackingQrCard token={qrToken} caption="Show this to the customer or print it for their receipt." />
        </Modal>
      )}

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Services</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-400">Loading...</td></tr>}
            {appointments?.map((a) => (
              <tr key={a.id} className="hover:bg-ink-800">
                <td className="px-4 py-3 font-medium">{new Date(a.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                <td className="px-4 py-3">{a.customer.name}<div className="text-xs text-ink-400">{a.customer.phone}</div></td>
                <td className="px-4 py-3">{a.vehicle.make} {a.vehicle.model}<div className="text-xs text-ink-400">{a.vehicle.plate}</div></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {a.serviceItems.map((s, i) => <span key={i} className="badge bg-brand-500/10 text-brand-300 text-[11px]">{s.catalogItem.name}</span>)}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-500">{a.source}</td>
                <td className="px-4 py-3"><span className="badge bg-ink-800 text-ink-300">{a.status}</span></td>
                <td className="px-4 py-3">
                  {a.status === "CONFIRMED" && (
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs" onClick={() => checkIn.mutate(a.id)}><LogIn size={13} /> Check in</button>
                      <button className="btn-secondary text-xs" onClick={() => cancel.mutate(a.id)}>Cancel</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !appointments?.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-400">No appointments for this day.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
