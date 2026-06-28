import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Upload } from "lucide-react";
import { api } from "../lib/api";

interface VehicleHit { id: string; plate: string; make: string; model: string; customer: { name: string } }
interface Inspection {
  id: string; checklist: { item: string; status: string }[]; dtcCodes: string[]; mileage?: number;
  findings?: string; createdAt: string; photos: { id: string; url: string }[];
}
interface VehicleFull extends VehicleHit {
  year: number; inspections: Inspection[];
}

const CHECKLIST_ITEMS = ["Engine oil", "Brake pads", "Tire pressure", "Coolant level", "Battery", "Lights"];
const CHECKLIST_BADGE: Record<string, string> = { OK: "badge-done", ATTENTION: "badge-warn", FAILED: "badge-danger" };

export function Maintenance() {
  const [plate, setPlate] = useState("");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [results, setResults] = useState<VehicleHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");

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

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleFull>(`/vehicles/${vehicleId}`),
    enabled: !!vehicleId,
  });

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex gap-2 max-w-md">
          <input className="input" placeholder="Search by plate number..." value={plate} onChange={(e) => setPlate(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn-secondary" onClick={search}><Search size={16} /></button>
        </div>
        {searchError && <p className="alert-danger mt-2">{searchError}</p>}
        {results.length > 0 && (
          <div className="mt-2 space-y-1">
            {results.map((v) => (
              <button key={v.id} onClick={() => { setVehicleId(v.id); setResults([]); setSearched(false); }} className="flex w-full items-center justify-between text-sm border border-ink-800 rounded-sm px-3 py-2 hover:border-brand-300">
                <span>{v.make} {v.model} - {v.plate}</span>
                <span className="text-ink-500">{v.customer.name}</span>
              </button>
            ))}
          </div>
        )}
        {searched && !searchError && !results.length && !vehicleId && (
          <p className="text-ink-400 text-sm mt-2">No vehicle found with that plate number.</p>
        )}
      </div>

      {vehicle && <VehiclePanel vehicle={vehicle} />}
    </div>
  );
}

function VehiclePanel({ vehicle }: { vehicle: VehicleFull }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["vehicle", vehicle.id] });

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-ink-200">{vehicle.make} {vehicle.model} ({vehicle.year})</h2>
          <p className="text-sm text-ink-500">{vehicle.plate} &middot; {vehicle.customer.name}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>New inspection</button>
      </div>

      {showForm && <InspectionForm vehicleId={vehicle.id} onDone={() => { setShowForm(false); refresh(); }} />}

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-3">Inspection history</h3>
        <div className="space-y-3">
          {vehicle.inspections.map((insp) => (
            <div key={insp.id} className="border border-ink-800 rounded-sm p-3 text-sm">
              <div className="flex justify-between text-ink-500 text-xs mb-1">
                <span>{new Date(insp.createdAt).toLocaleString()}</span>
                {insp.mileage && <span>{insp.mileage.toLocaleString()} km</span>}
              </div>
              <div className="flex flex-wrap gap-1 mb-1">
                {insp.checklist.map((c, i) => (
                  <span key={i} className={`${CHECKLIST_BADGE[c.status]} text-[11px]`}>{c.item}: {c.status}</span>
                ))}
              </div>
              {insp.dtcCodes.length > 0 && <p className="text-xs text-red-400">DTC: {insp.dtcCodes.join(", ")}</p>}
              {insp.findings && <p className="text-xs text-ink-400">{insp.findings}</p>}
            </div>
          ))}
          {!vehicle.inspections.length && <p className="text-ink-400 text-sm">No inspections recorded yet.</p>}
        </div>
      </div>
    </div>
  );
}

function InspectionForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const [checklist, setChecklist] = useState(CHECKLIST_ITEMS.map((item) => ({ item, status: "OK" as const })));
  const [dtcCodes, setDtcCodes] = useState("");
  const [mileage, setMileage] = useState<number | "">("");
  const [findings, setFindings] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const inspection = await api.post<{ id: string }>("/maintenance/inspections", {
        vehicleId,
        checklist,
        dtcCodes: dtcCodes ? dtcCodes.split(",").map((c) => c.trim()) : [],
        mileage: mileage === "" ? undefined : mileage,
        findings: findings || undefined,
      });
      if (files?.length) {
        const formData = new FormData();
        Array.from(files).forEach((f) => formData.append("photos", f));
        await api.post(`/maintenance/inspections/${inspection.id}/photos`, formData);
      }
    },
    onSuccess: onDone,
  });

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-ink-200">New inspection</h3>
      <div className="grid grid-cols-2 gap-2">
        {checklist.map((c, i) => (
          <div key={c.item} className="flex items-center justify-between border border-ink-800 rounded-sm px-3 py-2 text-sm">
            <span>{c.item}</span>
            <select
              className="input w-auto text-xs py-1"
              value={c.status}
              onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, status: e.target.value as any } : x)))}
            >
              <option value="OK">OK</option>
              <option value="ATTENTION">Attention</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">DTC codes (comma separated, manually read off scanner)</label><input className="input" value={dtcCodes} onChange={(e) => setDtcCodes(e.target.value)} /></div>
        <div><label className="label">Mileage (km)</label><input className="input" type="number" value={mileage} onChange={(e) => setMileage(e.target.value ? Number(e.target.value) : "")} /></div>
      </div>
      <div><label className="label">Findings / notes</label><textarea className="input" value={findings} onChange={(e) => setFindings(e.target.value)} /></div>
      <div>
        <label className="label flex items-center gap-1"><Upload size={14} /> Photos</label>
        <input type="file" multiple accept="image/*" onChange={(e) => setFiles(e.target.files)} />
      </div>
      <button className="btn-primary" onClick={() => submit.mutate()} disabled={submit.isPending}>Save inspection</button>
    </div>
  );
}
