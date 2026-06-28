import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface Item { id: string; name: string; unit: string; category: string; stockLevel: number; reorderThreshold: number; costPerUnit: number }
interface Supplier { id: string; name: string }
interface PO { id: string; status: string; supplier: Supplier; items: { qty: number; unitCost: number; inventoryItem: Item }[] }

export function Inventory() {
  const { user } = useAuth();
  // ADMIN's only inventory job is PO approval -- everything else here (items, suppliers,
  // stock adjustment, receiving) is day-to-day MANAGER work, blocked on the backend for
  // ADMIN, so it's hidden rather than shown disabled or erroring.
  const canOperate = user?.role !== "ADMIN";
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ["inventory"], queryFn: () => api.get<Item[]>("/inventory/items"), enabled: canOperate });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/inventory/suppliers"), enabled: canOperate });
  const { data: pos } = useQuery({ queryKey: ["pos"], queryFn: () => api.get<PO[]>("/inventory/purchase-orders") });
  const [showForm, setShowForm] = useState(false);

  const adjust = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) => api.patch(`/inventory/items/${id}/adjust`, { delta, reason: "Manual adjustment" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory"] }),
  });
  const createItem = useMutation({
    mutationFn: (body: any) => api.post("/inventory/items", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); setShowForm(false); },
  });
  const receivePO = useMutation({ mutationFn: (id: string) => api.patch(`/inventory/purchase-orders/${id}/receive`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["pos"] }); qc.invalidateQueries({ queryKey: ["inventory"] }); } });
  const approvePO = useMutation({ mutationFn: (id: string) => api.patch(`/inventory/purchase-orders/${id}/approve`), onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }) });

  return (
    <div className="space-y-6">
      {canOperate && (
        <>
          <div className="flex items-center justify-end">
            <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> New item</button>
          </div>

          {showForm && <NewItemForm onClose={() => setShowForm(false)} onSubmit={(b) => createItem.mutate(b)} />}

          <div className="card !p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-950 text-ink-500 text-left">
                <tr><th className="px-4 py-3">Item</th><th className="px-4 py-3">Stock</th><th className="px-4 py-3">Reorder at</th><th className="px-4 py-3">Cost/unit</th><th className="px-4 py-3">Adjust</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {items?.map((item) => {
                  const low = item.stockLevel <= item.reorderThreshold;
                  return (
                    <tr key={item.id} className={low ? "bg-red-500/10" : ""}>
                      <td className="px-4 py-3 font-medium">{item.name} {low && <AlertTriangle size={14} className="inline text-red-500 ml-1" />}</td>
                      <td className="px-4 py-3">{item.stockLevel} {item.unit}</td>
                      <td className="px-4 py-3 text-ink-500">{item.reorderThreshold} {item.unit}</td>
                      <td className="px-4 py-3 text-ink-500">RWF {item.costPerUnit.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button className="btn-secondary text-xs px-2" onClick={() => adjust.mutate({ id: item.id, delta: 10 })}>+10</button>
                          <button className="btn-secondary text-xs px-2" onClick={() => adjust.mutate({ id: item.id, delta: -10 })}>-10</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-3">Purchase orders{canOperate ? ` (${suppliers?.length ?? 0} suppliers)` : ""}</h3>
        <div className="space-y-2">
          {pos?.map((po) => (
            <div key={po.id} className="flex items-center justify-between border border-ink-800 rounded-sm px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{po.supplier.name}</span>
                <span className="text-ink-500"> &middot; {po.items.map((i) => `${i.inventoryItem.name} x${i.qty}`).join(", ")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge bg-ink-800 text-ink-300">{po.status}</span>
                {po.status === "DRAFT" && <button className="btn-secondary text-xs" onClick={() => approvePO.mutate(po.id)}>Approve</button>}
                {canOperate && po.status === "APPROVED" && <button className="btn-primary text-xs" onClick={() => receivePO.mutate(po.id)}>Receive</button>}
              </div>
            </div>
          ))}
          {!pos?.length && <p className="text-ink-400 text-sm">No purchase orders yet.</p>}
        </div>
      </div>
    </div>
  );
}

function NewItemForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (b: any) => void }) {
  const [form, setForm] = useState({ name: "", unit: "units", category: "CONSUMABLE", stockLevel: 0, reorderThreshold: 10, costPerUnit: 0 });
  return (
    <form className="card grid grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <div><label className="label">Name</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><label className="label">Unit</label><input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
      <div>
        <label className="label">Category</label>
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="CHEMICAL">Chemical</option><option value="PART">Part</option><option value="CONSUMABLE">Consumable</option>
        </select>
      </div>
      <div><label className="label">Stock level</label><input className="input" type="number" value={form.stockLevel} onChange={(e) => setForm({ ...form, stockLevel: Number(e.target.value) })} /></div>
      <div><label className="label">Reorder threshold</label><input className="input" type="number" value={form.reorderThreshold} onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })} /></div>
      <div><label className="label">Cost/unit (RWF)</label><input className="input" type="number" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: Number(e.target.value) })} /></div>
      <div className="col-span-3 flex gap-2"><button className="btn-primary" type="submit">Save</button><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button></div>
    </form>
  );
}
