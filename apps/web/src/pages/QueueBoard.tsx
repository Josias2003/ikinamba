import { useEffect, useMemo, useState } from "react";
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
// they're not permitted to use. Floor dispatch (walk-in, bay assignment, technician
// assignment, completion) is RECEPTIONIST's own named job; QC sign-off is TECHNICIAN's --
// MANAGER doesn't duplicate either anymore (real per-role separation, not seniority), it
// keeps page access to see the floor at a glance but the action buttons aren't its job.
// ADMIN has no access to this page at all, see Layout.tsx NAV_GROUPS.
const CAN_ASSIGN_BAY = ["RECEPTIONIST"];
const CAN_WALK_IN = ["RECEPTIONIST"];
const CAN_SIGN_QC = ["TECHNICIAN"];
// Assigning/reassigning any job is RECEPTIONIST's dispatch call. A TECHNICIAN may
// additionally hand off a job already assigned to themselves (see the ownership check
// where this is used below) -- never claim an unassigned job or reassign someone else's.
const CAN_ASSIGN_TECH = ["RECEPTIONIST", "TECHNICIAN"];
// RECEPTIONIST can release any vehicle; TECHNICIAN can release one assigned to themselves
// (ownership checked where this is used below).
const CAN_COMPLETE_ANY = ["RECEPTIONIST"];
const CAN_COMPLETE_OWN = ["TECHNICIAN"];

export function QueueBoard() {
  const [waitingFilter, setWaitingFilter] = useState("");
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pickupSuccess, setPickupSuccess] = useState<Entry | null>(null);
  const { data: board } = useQuery({ queryKey: ["queue-board"], queryFn: () => api.get<Board>("/queue/board") });
  const visibleWaiting = useMemo(() => {
    const term = waitingFilter.trim().toLowerCase();
    if (!term) return board?.waiting;
    return board?.waiting.filter((e) => e.vehicle.plate.toLowerCase().includes(term) || e.customer.name.toLowerCase().includes(term));
  }, [board?.waiting, waitingFilter]);
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
      await complete.mutateAsync(entry.id);
      setPickupSuccess(entry);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3">
          {user && (CAN_COMPLETE_ANY.includes(user.role) || CAN_COMPLETE_OWN.includes(user.role)) && (
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
          <TrackingQrCard token={qrToken} caption="Show this to the customer -- they can scan it anytime to follow live progress." />
        </Modal>
      )}

      {scanning && (
        <Modal title="Scan customer QR to confirm pickup" onClose={() => setScanning(false)}>
          <QrScanner onToken={handleScan} onError={(msg) => { setScanning(false); setError(msg); }} />
        </Modal>
      )}

      {pickupSuccess && (
        <Modal title="Pickup confirmed" onClose={() => setPickupSuccess(null)}>
          <div className="text-center space-y-3 py-2">
            <CheckCircle2 size={40} className="text-brand-400 mx-auto" />
            <p className="text-ink-100 font-medium">
              {pickupSuccess.vehicle.make} {pickupSuccess.vehicle.model} ({pickupSuccess.vehicle.plate})
            </p>
            <p className="text-ink-400 text-sm">{pickupSuccess.customer.name} has picked up their vehicle.</p>
            <button className="btn-primary w-full" onClick={() => setPickupSuccess(null)}>Done</button>
          </div>
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

                  {user && CAN_ASSIGN_TECH.includes(user.role) && (user.role !== "TECHNICIAN" || entry.serviceJob?.technician?.id === user.id) ? (
                    <select
                      className="input text-xs"
                      value={entry.serviceJob?.technician?.id ?? ""}
                      onChange={(e) => assignTechnician.mutate({ id: entry.id, technicianId: e.target.value })}
                    >
                      <option value="">Assign technician...</option>
                      {technicians?.map((t) => <option key={t.id} value={t.id}>{t.email}</option>)}
                    </select>
                  ) : (
                    <p className="text-xs text-ink-500">
                      Technician: {entry.serviceJob?.technician?.email ?? "unassigned"}
                    </p>
                  )}

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
                      <span className="text-xs text-ink-400">Awaiting technician sign-off</span>
                    )}
                    {entry.status === "READY" && user &&
                      (CAN_COMPLETE_ANY.includes(user.role) || (CAN_COMPLETE_OWN.includes(user.role) && entry.serviceJob?.technician?.id === user.id)) && (
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

      {!waitingFilter && !board?.waiting.length ? (
        <div className="flex items-center gap-2 text-sm text-ink-400 border border-ink-800 rounded-sm px-3 py-2">
          <CheckCircle2 size={14} className="text-brand-400" /> No vehicles waiting.
        </div>
      ) : (
        <div className="card">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-ink-200">Waiting ({board?.waiting.length ?? 0})</h3>
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-2 text-ink-400" size={14} />
              <input className="input pl-8 text-xs py-1.5" placeholder="Filter plate or customer..." value={waitingFilter} onChange={(e) => setWaitingFilter(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            {visibleWaiting?.map((e, i) => (
              <div key={e.id} className="flex items-center justify-between text-sm border border-ink-800 rounded-sm px-3 py-2">
                <span className="text-ink-400 w-6">#{i + 1}</span>
                <span className="flex-1">{e.vehicle.make} {e.vehicle.model} - {e.vehicle.plate}</span>
                <span className="text-ink-500">{e.customer.name}</span>
                <button onClick={() => setQrToken(e.trackingToken)} className="text-brand-400 hover:underline flex items-center gap-1">
                  <QrCode size={12} /> Show QR
                </button>
              </div>
            ))}
            {!visibleWaiting?.length && (
              <p className="text-ink-400 text-sm">No waiting vehicles match "{waitingFilter}".</p>
            )}
          </div>
        </div>
      )}
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
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [newWalkIn, setNewWalkIn] = useState({
    customerName: "",
    phone: "",
    email: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
    color: "",
  });
  const checkIn = useMutation({
    mutationFn: (v: VehicleHit) => api.post<Entry>("/queue/walk-in", { customerId: v.customer.id, vehicleId: v.id }),
    onSuccess: (entry) => { onCheckedIn(entry); setPlate(""); setResults([]); setSearched(false); },
    onError: (err) => setSearchError(err instanceof ApiError ? err.message : "Check-in failed."),
  });
  const registerWalkIn = useMutation({
    mutationFn: () => api.post<Entry>("/queue/walk-in", {
      customer: {
        name: newWalkIn.customerName,
        phone: newWalkIn.phone,
        email: newWalkIn.email || undefined,
      },
      vehicle: {
        make: newWalkIn.make,
        model: newWalkIn.model,
        year: Number(newWalkIn.year),
        plate: plate.trim().toUpperCase(),
        color: newWalkIn.color || undefined,
      },
    }),
    onSuccess: (entry) => {
      onCheckedIn(entry);
      setPlate("");
      setResults([]);
      setSearched(false);
      setNewWalkIn({ customerName: "", phone: "", email: "", make: "", model: "", year: new Date().getFullYear(), color: "" });
    },
    onError: (err) => setSearchError(err instanceof ApiError ? err.message : "Registration failed."),
  });

  async function search() {
    setSearchError("");
    try {
      const hits = await api.get<VehicleHit[]>(`/vehicles?plate=${encodeURIComponent(plate)}`);
      setResults(hits);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
      setSearchError("Search failed -- check your connection and try again.");
    }
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-ink-200 mb-2 flex items-center gap-2"><UserPlus size={18} /> Walk-in check-in</h3>
      <div className="flex gap-2 max-w-md">
        <input className="input" placeholder="Search plate number..." value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="btn-secondary" onClick={search} disabled={!plate.trim()}><Search size={16} /></button>
      </div>
      {searchError && <p className="alert-danger mt-2">{searchError}</p>}
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
      {searched && !searchError && !results.length && (
        <form
          className="mt-4 border border-ink-800 rounded-sm p-3 space-y-3"
          onSubmit={(e) => { e.preventDefault(); registerWalkIn.mutate(); }}
        >
          <p className="text-sm text-ink-300">No vehicle found. Register this walk-in and add it to the queue.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="label">Owner name</label><input className="input" required value={newWalkIn.customerName} onChange={(e) => setNewWalkIn({ ...newWalkIn, customerName: e.target.value })} /></div>
            <div><label className="label">Phone</label><input className="input" required value={newWalkIn.phone} onChange={(e) => setNewWalkIn({ ...newWalkIn, phone: e.target.value })} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={newWalkIn.email} onChange={(e) => setNewWalkIn({ ...newWalkIn, email: e.target.value })} /></div>
            <div><label className="label">Make</label><input className="input" required value={newWalkIn.make} onChange={(e) => setNewWalkIn({ ...newWalkIn, make: e.target.value })} /></div>
            <div><label className="label">Model</label><input className="input" required value={newWalkIn.model} onChange={(e) => setNewWalkIn({ ...newWalkIn, model: e.target.value })} /></div>
            <div><label className="label">Year</label><input className="input" type="number" min={1980} max={2100} required value={newWalkIn.year} onChange={(e) => setNewWalkIn({ ...newWalkIn, year: Number(e.target.value) })} /></div>
            <div><label className="label">Color</label><input className="input" value={newWalkIn.color} onChange={(e) => setNewWalkIn({ ...newWalkIn, color: e.target.value })} /></div>
            <div><label className="label">Plate</label><input className="input" required value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} /></div>
          </div>
          <button className="btn-primary" type="submit" disabled={registerWalkIn.isPending}>
            <UserPlus size={14} /> Register and check in
          </button>
        </form>
      )}
    </div>
  );
}
