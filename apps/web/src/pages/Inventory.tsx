import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, PackagePlus, Search, Info } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Modal } from "../components/Modal";
import { SortableHeader, toggleSort, compareBy, type SortState } from "../components/SortableHeader";

interface Item { id: string; name: string; unit: string; category: string; stockLevel: number; reorderThreshold: number; costPerUnit: number }
interface Supplier { id: string; name: string }
interface PO { id: string; status: string; supplier: Supplier; items: { qty: number; unitCost: number; inventoryItem: Item }[] }

type SortField = "name" | "stockLevel" | "reorderThreshold" | "costPerUnit";

export function Inventory() {
  const { user } = useAuth();
  // ADMIN's only inventory job is PO approval -- everything else here (items, suppliers,
  // stock adjustment, receiving) is day-to-day MANAGER work, blocked on the backend for
  // ADMIN, so it's hidden rather than shown disabled or erroring.
  const isAdmin = user?.role === "ADMIN";
  const canOperate = !isAdmin;
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ["inventory"], queryFn: () => api.get<Item[]>("/inventory/items"), enabled: canOperate });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/inventory/suppliers"), enabled: canOperate });
  const { data: allPos } = useQuery({ queryKey: ["pos"], queryFn: () => api.get<PO[]>("/inventory/purchase-orders") });
  // ADMIN's only action here is approval, which only ever applies to a DRAFT PO -- show
  // just that slice instead of every PO regardless of status.
  const pos = isAdmin ? allPos?.filter((po) => po.status === "DRAFT") : allPos;
  const [showForm, setShowForm] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState<Item | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortField>>({ field: null, direction: "asc" });

  const visibleItems = useMemo(() => {
    if (!items) return items;
    const term = search.trim().toLowerCase();
    let list = term ? items.filter((i) => i.name.toLowerCase().includes(term)) : items;
    const field = sort.field;
    if (field) list = [...list].sort((a, b) => compareBy(a, b, (i) => i[field], sort.direction));
    return list;
  }, [items, search, sort]);

  const adjust = useMutation({
    mutationFn: ({ id, delta, reason }: { id: string; delta: number; reason: string }) => api.patch(`/inventory/items/${id}/adjust`, { delta, reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); setAdjustingItem(null); },
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

          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-2.5 text-ink-400" size={16} />
            <input className="input pl-9" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="card !p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-950 text-ink-500 text-left">
                <tr>
                  <SortableHeader className="px-4 py-3" field="name" label="Item" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
                  <SortableHeader className="px-4 py-3" field="stockLevel" label="Stock" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
                  <SortableHeader className="px-4 py-3" field="reorderThreshold" label="Reorder at" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
                  <SortableHeader className="px-4 py-3" field="costPerUnit" label="Cost/unit" sort={sort} onSort={(f) => setSort(toggleSort(sort, f))} />
                  <th className="px-4 py-3">Adjust</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {!visibleItems?.length && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-400">{search ? "No items match your search." : "No inventory items yet."}</td></tr>
                )}
                {visibleItems?.map((item) => {
                  const low = item.stockLevel <= item.reorderThreshold;
                  return (
                    <tr key={item.id} className={low ? "bg-red-500/10" : ""}>
                      <td className="px-4 py-3 font-medium text-ink-100">{item.name} {low && <AlertTriangle size={14} className="inline text-red-500 ml-1" />}</td>
                      <td className="px-4 py-3 text-ink-200">{item.stockLevel} {item.unit}</td>
                      <td className="px-4 py-3 text-ink-400">{item.reorderThreshold} {item.unit}</td>
                      <td className="px-4 py-3 text-ink-400">RWF {item.costPerUnit.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <button className="btn-secondary text-xs" onClick={() => setAdjustingItem(item)}>
                          <PackagePlus size={13} /> Adjust
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isAdmin && (
        <div className="alert-warn flex items-center gap-2">
          <Info size={14} /> Showing draft purchase orders only -- approval is your only action here.
        </div>
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
                {isAdmin && po.status === "DRAFT" && <button className="btn-secondary text-xs" onClick={() => approvePO.mutate(po.id)}>Approve</button>}
                {canOperate && po.status === "APPROVED" && <button className="btn-primary text-xs" onClick={() => receivePO.mutate(po.id)}>Receive</button>}
              </div>
            </div>
          ))}
          {!pos?.length && <p className="text-ink-400 text-sm">No purchase orders yet.</p>}
        </div>
      </div>

      {adjustingItem && (
        <Modal title={`Adjust stock — ${adjustingItem.name}`} onClose={() => setAdjustingItem(null)}>
          <AdjustStockForm
            item={adjustingItem}
            onSubmit={(delta, reason) => adjust.mutate({ id: adjustingItem.id, delta, reason })}
            pending={adjust.isPending}
          />
        </Modal>
      )}
    </div>
  );
}

function AdjustStockForm({ item, onSubmit, pending }: { item: Item; onSubmit: (delta: number, reason: string) => void; pending: boolean }) {
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => { e.preventDefault(); onSubmit(direction === "add" ? qty : -qty, reason || "Manual adjustment"); }}
    >
      <p className="text-sm text-ink-400">Current stock: <span className="text-ink-100 font-medium">{item.stockLevel} {item.unit}</span></p>
      <div className="flex gap-2">
        <button type="button" className={direction === "add" ? "btn-primary flex-1" : "btn-secondary flex-1"} onClick={() => setDirection("add")}>Add stock</button>
        <button type="button" className={direction === "remove" ? "btn-primary flex-1" : "btn-secondary flex-1"} onClick={() => setDirection("remove")}>Remove stock</button>
      </div>
      <div>
        <label className="label">Quantity ({item.unit})</label>
        <input className="input" type="number" min={1} required value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} />
      </div>
      <div>
        <label className="label">Reason</label>
        <input className="input" placeholder="e.g. received delivery, spoilage, count correction" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <button className="btn-primary w-full" type="submit" disabled={!qty || pending}>
        {direction === "add" ? `Add ${qty || 0} ${item.unit}` : `Remove ${qty || 0} ${item.unit}`}
      </button>
    </form>
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
      <div><label className="label">Stock level</label><input className="input" type="number" min={0} value={form.stockLevel} onChange={(e) => setForm({ ...form, stockLevel: Number(e.target.value) })} /></div>
      <div><label className="label">Reorder threshold</label><input className="input" type="number" min={0} value={form.reorderThreshold} onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })} /></div>
      <div><label className="label">Cost/unit (RWF)</label><input className="input" type="number" min={0} value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: Number(e.target.value) })} /></div>
      <div className="col-span-3 flex gap-2"><button className="btn-primary" type="submit">Save</button><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button></div>
    </form>
  );
}
