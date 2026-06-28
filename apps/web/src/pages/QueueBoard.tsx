import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, UserPlus, Search, CheckCircle2, ShieldCheck, Plus, QrCode, ScanLine, AlertTriangle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { socket } from "../lib/socket";
import { useAuth } from "../context/AuthContext";
import { Modal } from "../components/Modal";
import { TrackingQrCard } from "../components/TrackingQrCard";
import { QrScanner } from "../components/QrScanner";

interface Entry {
  id: string; status: string; checkedInAt: string; trackingToken: string;
  customer: { name: string }; vehicle: { make: string; model: string; plate: string };
  serviceJob?: { items: { name: string }[]; technician?: { id: string; email: string } | null } | null;
}
interface Bay { id: string; name: string; status: string; queueEntries: Entry[] }
interface Board { bays: Bay[]; waiting: Entry[] }
interface VehicleHit { id: string; plate: string; make: string; model: string; customer: { id: string; name: string } }
interface CatalogItem { id: string; name: string; basePrice: number }
interface Technician { id: string; email: string }

const STATUS_LABEL: Record<string, string> = { IN_SERVICE: "In service", QUALITY_CHECK: "Quality check" };
const BAY_BADGE: Record<string, string> = { IDLE: "badge-neutral", OCCUPIED: "badge-live", MAINTENANCE: "badge-danger" };

// Mirrors the backend's RBAC per route (see queue.routes.ts) so staff aren't shown buttons
// they're not permitted to use -- e.g. a receptionist can move a job to QC but can't sign off
// on it themselves (separation of duties), so that button is hidden rather than failing silently.
// ADMIN doesn't run the floor (real per-role separation, not seniority) -- it has no
// access to this page at all, see Layout.tsx NAV_GROUPS.
const CAN_ASSIGN_BAY = ["MANAGER", "RECEPTIONIST"];
const CAN_WALK_IN = ["MANAGER", "RECEPTIONIST"];
const CAN_SIGN_QC = ["MANAGER", "TECHNICIAN"];

const CAN_COMPLETE = ["MANAGER", "RECEPTIONIST"];

export function QueueBoard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const { data: board } = useQuery({ queryKey: ["queue-board"], queryFn: () => api.get<Board>("/queue/board") });
  const { data: technicians } = useQuery({ queryKey: ["technicians"], queryFn: () => api.get<Technician[]>("/queue/technicians") });
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: () => api.get<CatalogItem[]>("/catalog", { auth: false }) });

  useEffect(() => {
    socket.connect();
    socket.emit("join:queueBoard");
    const refresh = () => qc.invalidateQueries({ queryKey: ["queue-board"] });
    socket.on("queueBoard:update", refresh);
    return () => {
      socket.off("queueBoard:update", refresh);
      socket.disconnect();
    };
  }, [qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["queue-board"] });
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : "Something went wrong");
  const assignNext = useMutation({ mutationFn: (bayId: string) => api.post(`/queue/bays/${bayId}/assign-next`), onSuccess: refresh, onError });
  const moveToQc = useMutation({ mutationFn: (id: string) => api.patch(`/queue/${id}/quality-check`), onSuccess: refresh, onError });
  const signQc = useMutation({ mutationFn: (id: string) => api.patch(`/queue/${id}/sign-quality-check`), onSuccess: refresh, onError });
  const complete = useMutation({ mutationFn: (id: string) => api.patch(`/queue/${id}/complete`), onSuccess: refresh, onError });
  const addItems = useMutation({ mutationFn: ({ id, itemIds }: { id: string; itemIds: string[] }) => api.post(`/queue/${id}/items`, { catalogItemIds: itemIds }), onSuccess: refresh, onError });
  const assignTechnician = useMutation({ mutationFn: ({ id, technicianId }: { id: string; technicianId: string }) => api.patch(`/queue/${id}/technician`, { technicianId }), onSuccess: refresh, onError });

  async function handleScan(token: string) {
    setScanning(false);
    try {
      const entry = await api.get<Entry>(`/queue/by-token/${token}`);
      if (entry.status !== "READY") {
        setError(`That vehicle is not ready for pickup yet (status: ${STATUS_LABEL[entry.status] ?? entry.status}).`);
        return;
      }
      complete.mutate(entry.id);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3">
          {user && CAN_COMPLETE.includes(user.role) && (
            <button className="btn-secondary text-xs" onClick={() => setScanning(true)}>
              <ScanLine size={14} /> Scan to pick up
            </button>
          )}
          <span className="badge-live text-[10px]">Live</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between alert-danger">
          <span className="flex items-center gap-2"><AlertTriangle size={14} /> {error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-red-200">&times;</button>
        </div>
      )}

      {qrToken && (
        <Modal title="Customer tracking QR" onClose={() => setQrToken(null)}>
          <TrackingQrCard token={qrToken} caption="Show this to the customer or print it for their receipt." />
        </Modal>
      )}

      {scanning && (
        <Modal title="Scan customer QR to confirm pickup" onClose={() => setScanning(false)}>
          <QrScanner onToken={handleScan} onError={(msg) => { setScanning(false); setError(msg); }} />
        </Modal>
      )}

      {user && CAN_WALK_IN.includes(user.role) && <WalkInForm onCheckedIn={(entry) => { refresh(); setQrToken(entry.trackingToken); }} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {board?.bays.map((bay) => {
          const entry = bay.queueEntries[0];
          return (
            <div key={bay.id} className="card">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-ink-200">{bay.name}</h3>
                <span className={BAY_BADGE[bay.status] ?? "badge-neutral"}>{bay.status}</span>
              </div>

              {entry ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><Car size={16} className="text-brand-400" /><span className="font-medium text-sm">{entry.vehicle.make} {entry.vehicle.model} - {entry.vehicle.plate}</span></div>
                  <p className="text-xs text-ink-500">{entry.customer.name}</p>
                  <span className="badge bg-ink-800 text-ink-300">{STATUS_LABEL[entry.status]}</span>
                  <button onClick={() => setQrToken(entry.trackingToken)} className="flex items-center gap-1 text-xs text-brand-400 hover:underline">
                    <QrCode size={12} /> Show QR
                  </button>

                  <div className="flex flex-wrap gap-1">
                    {entry.serviceJob?.items.map((it, i) => <span key={i} className="badge bg-brand-500/10 text-brand-300 text-[11px]">{it.name}</span>)}
                  </div>

                  <AddItemsControl catalog={catalog} onAdd={(itemIds) => addItems.mutate({ id: entry.id, itemIds })} />

                  <select
                    className="input text-xs"
                    value={entry.serviceJob?.technician?.id ?? ""}
                    onChange={(e) => assignTechnician.mutate({ id: entry.id, technicianId: e.target.value })}
                  >
                    <option value="">Assign technician...</option>
                    {technicians?.map((t) => <option key={t.id} value={t.id}>{t.email}</option>)}
                  </select>

                  <div className="flex gap-2 pt-2">
                    {entry.status === "IN_SERVICE" && (
                      <button className="btn-secondary text-xs" onClick={() => moveToQc.mutate(entry.id)}>Move to QC</button>
                    )}
                    {entry.status === "QUALITY_CHECK" && user && CAN_SIGN_QC.includes(user.role) && (
                      <button className="btn-primary text-xs" onClick={() => signQc.mutate(entry.id)}>
                        <ShieldCheck size={14} /> Sign QC &amp; release
                      </button>
                    )}
                    {entry.status === "QUALITY_CHECK" && user && !CAN_SIGN_QC.includes(user.role) && (
                      <span className="text-xs text-ink-400">Awaiting technician/manager sign-off</span>
                    )}
                    {entry.status === "READY" && (
                      <button className="btn-secondary text-xs" onClick={() => complete.mutate(entry.id)}>
                        <CheckCircle2 size={14} /> Mark picked up
                      </button>
                    )}
                  </div>
                </div>
              ) : user && CAN_ASSIGN_BAY.includes(user.role) ? (
                <button className="btn-secondary w-full text-sm" disabled={!board?.waiting.length} onClick={() => assignNext.mutate(bay.id)}>
                  Assign next waiting vehicle
                </button>
              ) : (
                <p className="text-xs text-ink-400 text-center py-2">Idle</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-3">Waiting ({board?.waiting.length ?? 0})</h3>
        <div className="space-y-2">
          {board?.waiting.map((e, i) => (
            <div key={e.id} className="flex items-center justify-between text-sm border border-ink-800 rounded-sm px-3 py-2">
              <span className="text-ink-400 w-6">#{i + 1}</span>
              <span className="flex-1">{e.vehicle.make} {e.vehicle.model} - {e.vehicle.plate}</span>
              <span className="text-ink-500">{e.customer.name}</span>
              <button onClick={() => setQrToken(e.trackingToken)} className="text-brand-400 hover:underline flex items-center gap-1">
                <QrCode size={12} /> Show QR
              </button>
            </div>
          ))}
          {!board?.waiting.length && <p className="text-ink-400 text-sm">No vehicles waiting.</p>}
        </div>
      </div>
    </div>
  );
}

function AddItemsControl({ catalog, onAdd }: { catalog?: CatalogItem[]; onAdd: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  if (!open) return <button className="text-xs text-brand-400 hover:underline flex items-center gap-1" onClick={() => setOpen(true)}><Plus size={12} /> Add service</button>;
  return (
    <div className="border border-ink-700 rounded-sm p-2 space-y-1">
      {catalog?.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id))} />
          {c.name}
        </label>
      ))}
      <button className="btn-primary text-xs mt-1" onClick={() => { onAdd(selected); setSelected([]); setOpen(false); }}>Add</button>
    </div>
  );
}

function WalkInForm({ onCheckedIn }: { onCheckedIn: (entry: Entry) => void }) {
  const [plate, setPlate] = useState("");
  const [results, setResults] = useState<VehicleHit[]>([]);
  const checkIn = useMutation({
    mutationFn: (v: VehicleHit) => api.post<Entry>("/queue/walk-in", { customerId: v.customer.id, vehicleId: v.id }),
    onSuccess: (entry) => { onCheckedIn(entry); setPlate(""); setResults([]); },
  });

  async function search() {
    const hits = await api.get<VehicleHit[]>(`/vehicles?plate=${encodeURIComponent(plate)}`);
    setResults(hits);
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-ink-200 mb-2 flex items-center gap-2"><UserPlus size={18} /> Walk-in check-in</h3>
      <div className="flex gap-2 max-w-md">
        <input className="input" placeholder="Search plate number..." value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="btn-secondary" onClick={search}><Search size={16} /></button>
      </div>
      {results.length > 0 && (
        <div className="mt-2 space-y-1">
          {results.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm border border-ink-800 rounded-sm px-3 py-2">
              <span>{v.make} {v.model} - {v.plate} ({v.customer.name})</span>
              <button className="btn-primary text-xs" onClick={() => checkIn.mutate(v)}>Check in</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
