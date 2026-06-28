import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogIn, Search, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { Modal } from "../components/Modal";
import { TrackingQrCard } from "../components/TrackingQrCard";
import { SortableHeader, toggleSort, compareBy, type SortState } from "../components/SortableHeader";
import { useAuth } from "../context/AuthContext";

interface Appt {
  id: string; scheduledAt: string; status: string; source: string;
  customer: { name: string; phone: string }; vehicle: { make: string; model: string; plate: string };
  serviceItems: { catalogItem: { name: string } }[];
}

interface QueueEntry { trackingToken: string }

type SortField = "scheduledAt" | "customer" | "status";

export function Appointments() {
  const { user } = useAuth();
  // Appointment management is RECEPTIONIST's own named job -- MANAGER keeps page access
  // to see the day's bookings at a glance but the action buttons are not its job to use.
  const canOperate = user?.role === "RECEPTIONIST";
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortField>>({ field: null, direction: "asc" });
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appt | null>(null);
  const qc = useQueryClient();

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["appointments", date],
    queryFn: () => api.get<Appt[]>(`/appointments?date=${date}`),
  });

  const visible = useMemo(() => {
    if (!appointments) return appointments;
    const term = search.trim().toLowerCase();
    let list = term
      ? appointments.filter((a) => a.customer.name.toLowerCase().includes(term) || a.vehicle.plate.toLowerCase().includes(term))
      : appointments;
    if (sort.field) {
      const getValue = (a: Appt) => (sort.field === "scheduledAt" ? a.scheduledAt : sort.field === "customer" ? a.customer.name : a.status);
      list = [...list].sort((a, b) => compareBy(a, b, getValue, sort.direction));
    }
    return list;
  }, [appointments, search, sort]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["appointments", date] });
  const checkIn = useMutation({
    mutationFn: (id: string) => api.post<QueueEntry>(`/appointments/${id}/check-in`),
    onSuccess: (entry) => { refresh(); setQrToken(entry.trackingToken); },
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.patch(`/appointments/${id}/cancel`, { reason }),
    onSuccess: () => { refresh(); setCancelTarget(null); },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-2.5 text-ink-400" size={16} />
          <input className="input pl-9" placeholder="Search customer or plate..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <input className="input max-w-xs" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {qrToken && (
        <Modal title="Customer tracking QR" onClose={() => setQrToken(null)}>
          <TrackingQrCard token={qrToken} caption="Show this to the customer or print it for their receipt." />
        </Modal>
      )}

      {cancelTarget && (
        <CancelReasonModal
          appt={cancelTarget}
          pending={cancel.isPending}
          onClose={() => setCancelTarget(null)}
          onConfirm={(reason) => cancel.mutate({ id: cancelTarget.id, reason })}
        />
      )}

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr>
              <SortableHeader className="px-4 py-3" field="scheduledAt" label="Time" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
              <SortableHeader className="px-4 py-3" field="customer" label="Customer" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Services</th>
              <th className="px-4 py-3">Source</th>
              <SortableHeader className="px-4 py-3" field="status" label="Status" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-400">Loading...</td></tr>}
            {visible?.map((a) => (
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
                  {canOperate && a.status === "CONFIRMED" && (
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs" onClick={() => checkIn.mutate(a.id)}><LogIn size={13} /> Check in</button>
                      <button className="btn-secondary text-xs" onClick={() => setCancelTarget(a)}>Cancel</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !visible?.length && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-400">{search ? "No appointments match your search." : "No appointments for this day."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CancelReasonModal({
  appt,
  pending,
  onClose,
  onConfirm,
}: {
  appt: Appt;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Cancel appointment" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => { e.preventDefault(); onConfirm(reason); }}
      >
        <p className="text-sm text-ink-400">
          Cancelling {appt.customer.name}'s appointment for {appt.vehicle.make} {appt.vehicle.model} ({appt.vehicle.plate}).
          The customer will be emailed this reason.
        </p>
        <div>
          <label className="label">Reason</label>
          <textarea
            className="input"
            rows={3}
            required
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Bay unavailable due to equipment maintenance"
          />
        </div>
        <div className="flex gap-2">
          <button className="btn-danger flex-1" type="submit" disabled={!reason.trim() || pending}>
            {pending && <Loader2 size={14} className="animate-spin" />} Confirm cancellation
          </button>
          <button className="btn-secondary" type="button" onClick={onClose}>Back</button>
        </div>
      </form>
    </Modal>
  );
}
