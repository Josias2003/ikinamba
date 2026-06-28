import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { SortableHeader, toggleSort, type SortState } from "../components/SortableHeader";
import { Pagination } from "../components/Pagination";

// Sortable server-side (real columns on Customer); churn risk lives on a related model and
// isn't part of this list -- stays a plain column.
type SortField = "name" | "loyaltyPoints";

interface Vehicle { id: string; make: string; model: string; plate: string }
interface Insight { churnRiskLabel: string }
interface Customer {
  id: string; name: string; phone: string; email?: string | null;
  loyaltyTier: string; loyaltyPoints: number; vehicles: Vehicle[]; insight?: Insight | null;
}
interface Paged<T> { data: T[]; total: number; page: number; pageSize: number }

const TIER_BADGE: Record<string, string> = {
  GOLD: "badge-gold",
  SILVER: "badge-silver",
  BRONZE: "badge-bronze",
};
const RISK_BADGE: Record<string, string> = {
  HIGH: "badge-danger",
  MEDIUM: "badge-warn",
  LOW: "badge-done",
};

export function Customers() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [sort, setSort] = useState<SortState<SortField>>({ field: null, direction: "asc" });
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const qc = useQueryClient();

  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sortBy: sort.field, sortDir: sort.direction } : {}),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["customers", page, search, sort],
    queryFn: () => api.get<Paged<Customer>>(`/customers?${qs.toString()}`),
  });
  const customers = data?.data;

  function onSort(field: SortField) {
    setSort(toggleSort(sort, field));
    setPage(1);
  }

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post("/customers", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={16} /> New customer
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 text-ink-400" size={18} />
        <input
          className="input pl-9"
          placeholder="Search by name, phone, or plate..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {showForm && (
        <NewCustomerForm onClose={() => setShowForm(false)} onSubmit={(body) => createMutation.mutate(body)} />
      )}

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr>
              <SortableHeader className="px-4 py-3" field="name" label="Name" sort={sort} onSort={onSort} />
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Vehicles</th>
              <SortableHeader className="px-4 py-3" field="loyaltyPoints" label="Loyalty" sort={sort} onSort={onSort} />
              <th className="px-4 py-3">AI Churn Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-400">Loading...</td></tr>
            )}
            {!isLoading && !customers?.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-400">No customers match{search ? " your search" : ""}.</td></tr>
            )}
            {customers?.map((c) => (
              <tr key={c.id} className="hover:bg-ink-800">
                <td className="px-4 py-3">
                  <Link to={`/customers/${c.id}`} className="font-medium text-brand-300 hover:underline">{c.name}</Link>
                </td>
                <td className="px-4 py-3 text-ink-400">{c.phone}</td>
                <td className="px-4 py-3 text-ink-400">{c.vehicles.map((v) => v.plate).join(", ") || "-"}</td>
                <td className="px-4 py-3">
                  <span className={TIER_BADGE[c.loyaltyTier]}>{c.loyaltyTier}</span>{" "}
                  <span className="text-ink-400 text-xs">{c.loyaltyPoints} pts</span>
                </td>
                <td className="px-4 py-3">
                  {c.insight ? (
                    <span className={RISK_BADGE[c.insight.churnRiskLabel]}>{c.insight.churnRiskLabel}</span>
                  ) : (
                    <span className="text-ink-400 text-xs">n/a</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
    </div>
  );
}

function NewCustomerForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (body: any) => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "" });
  return (
    <div className="card">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-ink-200">New customer</h3>
        <button onClick={onClose}><X size={18} className="text-ink-400" /></button>
      </div>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ ...form, email: form.email || undefined, address: form.address || undefined });
        }}
      >
        <div><label className="label">Name</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">Phone</label><input className="input" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="col-span-2"><button className="btn-primary" type="submit">Save</button></div>
      </form>
    </div>
  );
}
