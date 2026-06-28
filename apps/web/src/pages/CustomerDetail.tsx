import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Car } from "lucide-react";
import { api } from "../lib/api";

const TIER_BADGE: Record<string, string> = { GOLD: "badge-gold", SILVER: "badge-silver", BRONZE: "badge-bronze" };

interface CustomerFull {
  id: string; name: string; phone: string; email?: string | null; address?: string | null;
  loyaltyTier: string; loyaltyPoints: number; totalSpend: number;
  vehicles: { id: string; make: string; model: string; year: number; plate: string; color?: string }[];
  invoices: { id: string; total: number; status: string; createdAt: string }[];
  loyaltyTxns: { id: string; points: number; type: string; reason: string; createdAt: string }[];
  insight?: { churnRisk: number; churnRiskLabel: string; maintenanceDueScore: number } | null;
}

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showVehicleForm, setShowVehicleForm] = useState(false);

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.get<CustomerFull>(`/customers/${id}`),
  });

  const addVehicle = useMutation({
    mutationFn: (body: any) => api.post(`/customers/${id}/vehicles`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer", id] });
      setShowVehicleForm(false);
    },
  });

  if (isLoading || !customer) return <p className="text-ink-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <span className="panel-title">Customer</span>
          <h2 className="text-xl font-semibold text-ink-100 mt-1">{customer.name}</h2>
          <p className="text-ink-500 text-sm">{customer.phone} {customer.email ? `· ${customer.email}` : ""}</p>
        </div>
        <div className="text-right">
          <span className={TIER_BADGE[customer.loyaltyTier]}>{customer.loyaltyTier}</span>
          <div className="text-sm text-ink-500 mt-1">{customer.loyaltyPoints} loyalty points</div>
          <div className="text-sm text-ink-500">Total spend: RWF {customer.totalSpend.toLocaleString()}</div>
        </div>
      </div>

      {customer.insight && (
        <div className="card flex items-center gap-6">
          <div>
            <div className="text-xs text-ink-500">AI Churn Risk</div>
            <div className="font-semibold text-ink-200">{customer.insight.churnRiskLabel} ({Math.round(customer.insight.churnRisk * 100)}%)</div>
          </div>
          <div>
            <div className="text-xs text-ink-500">AI Maintenance-Due Score</div>
            <div className="font-semibold text-ink-200">{Math.round(customer.insight.maintenanceDueScore * 100)}%</div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-ink-200">Vehicles</h2>
          <button className="btn-secondary text-xs" onClick={() => setShowVehicleForm(true)}><Plus size={14} /> Add vehicle</button>
        </div>
        {showVehicleForm && (
          <VehicleForm onClose={() => setShowVehicleForm(false)} onSubmit={(b) => addVehicle.mutate(b)} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {customer.vehicles.map((v) => (
            <div key={v.id} className="flex items-center gap-3 border border-ink-800 rounded-sm p-3">
              <Car className="text-brand-400" size={20} />
              <div>
                <div className="font-medium text-ink-200">{v.make} {v.model} ({v.year})</div>
                <div className="text-xs text-ink-500">{v.plate} {v.color ? `· ${v.color}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold text-ink-200 mb-3">Invoice history</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-ink-800">
            {customer.invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="py-2"><Link to={`/billing/invoices/${inv.id}`} className="text-brand-300 hover:underline">{inv.id.slice(0, 10)}</Link></td>
                <td className="py-2 text-ink-400">{new Date(inv.createdAt).toLocaleDateString()}</td>
                <td className="py-2 text-ink-400">RWF {inv.total.toLocaleString()}</td>
                <td className="py-2"><span className="badge bg-ink-800 text-ink-300">{inv.status}</span></td>
              </tr>
            ))}
            {!customer.invoices.length && <tr><td className="py-2 text-ink-400">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VehicleForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (b: any) => void }) {
  const [form, setForm] = useState({ make: "", model: "", year: 2020, plate: "", color: "" });
  return (
    <form
      className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4 items-end"
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
    >
      <div><label className="label">Make</label><input className="input" required value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} /></div>
      <div><label className="label">Model</label><input className="input" required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
      <div><label className="label">Year</label><input className="input" type="number" min={1980} max={new Date().getFullYear() + 1} required value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} /></div>
      <div><label className="label">Plate</label><input className="input" required value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></div>
      <div className="flex gap-2">
        <button className="btn-primary" type="submit">Add</button>
        <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
