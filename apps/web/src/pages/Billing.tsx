import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Info } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { SortableHeader, toggleSort, type SortState } from "../components/SortableHeader";
import { Pagination } from "../components/Pagination";

interface Billable {
  id: string; customer: { id: string; name: string; loyaltyPoints: number }; vehicle: { make: string; model: string; plate: string };
  serviceJob?: { items: { name: string; price: number }[] } | null;
}
interface InvoiceRow { id: string; total: number; status: string; createdAt: string; customer: { name: string } }
interface Paged<T> { data: T[]; total: number; page: number; pageSize: number }

// Sortable server-side (real Invoice columns); customer name lives on a related model and
// isn't part of this list -- stays a plain column.
type SortField = "createdAt" | "total" | "status";

export function Billing() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  // Invoicing is CASHIER's own named job -- ADMIN's only billing job is refund sign-off
  // (on InvoiceDetail) and MANAGER doesn't duplicate CASHIER's action either, so this
  // panel (and its underlying /billing/billable, CASHIER-only on the backend) is hidden
  // for both rather than shown disabled or erroring.
  const canOperate = user?.role === "CASHIER";
  const qc = useQueryClient();
  const { data: billable } = useQuery({ queryKey: ["billable"], queryFn: () => api.get<Billable[]>("/billing/billable"), enabled: canOperate });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortField>>({ field: null, direction: "asc" });
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // ADMIN's only action on this page is refund, which only ever applies to a PAID
  // invoice -- show just that slice instead of every invoice regardless of status, per
  // the "don't list what you can't act on or verify" principle.
  const qs = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(isAdmin ? { status: "PAID" } : {}),
    ...(search ? { search } : {}),
    ...(sort.field ? { sortBy: sort.field, sortDir: sort.direction } : {}),
  });
  const { data } = useQuery({
    queryKey: ["invoices", isAdmin, page, search, sort],
    queryFn: () => api.get<Paged<InvoiceRow>>(`/billing/invoices?${qs.toString()}`),
  });
  const invoices = data?.data;

  function onSort(field: SortField) {
    setSort(toggleSort(sort, field));
    setPage(1);
  }

  const createInvoice = useMutation({
    mutationFn: (queueEntryId: string) => api.post("/billing/invoices", { queueEntryId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billable"] }); qc.invalidateQueries({ queryKey: ["invoices"] }); },
  });

  return (
    <div className="space-y-6">
      {canOperate && (
        <div className="card">
          <h3 className="font-semibold text-ink-200 mb-3">Ready to invoice</h3>
          <div className="space-y-2">
            {billable?.map((b) => {
              const total = b.serviceJob?.items.reduce((s, i) => s + i.price, 0) ?? 0;
              return (
                <div key={b.id} className="flex items-center justify-between border border-ink-800 rounded-sm px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{b.vehicle.make} {b.vehicle.model} - {b.vehicle.plate}</span>
                    <span className="text-ink-500"> &middot; {b.customer.name}</span>
                    <div className="text-xs text-ink-400">{b.serviceJob?.items.map((i) => i.name).join(", ")}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-ink-400">RWF {total.toLocaleString()}</span>
                    <button className="btn-primary text-xs" onClick={() => createInvoice.mutate(b.id)}>Generate invoice</button>
                  </div>
                </div>
              );
            })}
            {!billable?.length && <p className="text-ink-400 text-sm">Nothing pending -- all completed jobs are invoiced.</p>}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="alert-warn flex items-center gap-2">
          <Info size={14} /> Showing paid invoices only -- refund is your only action here.
        </div>
      )}

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-2.5 text-ink-400" size={16} />
        <input className="input pl-9" placeholder="Search customer..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <SortableHeader className="px-4 py-3" field="createdAt" label="Date" sort={sort} onSort={onSort} />
              <SortableHeader className="px-4 py-3" field="total" label="Total" sort={sort} onSort={onSort} />
              <SortableHeader className="px-4 py-3" field="status" label="Status" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {invoices?.map((inv) => (
              <tr key={inv.id} className="hover:bg-ink-800">
                <td className="px-4 py-3"><Link to={`/billing/invoices/${inv.id}`} className="text-brand-300 hover:underline">{inv.customer.name}</Link></td>
                <td className="px-4 py-3 text-ink-500">{new Date(inv.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">RWF {inv.total.toLocaleString()}</td>
                <td className="px-4 py-3"><span className="badge bg-ink-800 text-ink-300">{inv.status}</span></td>
              </tr>
            ))}
            {!invoices?.length && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-400">{search ? "No invoices match your search." : "No invoices yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
    </div>
  );
}
