import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface Billable {
  id: string; customer: { id: string; name: string; loyaltyPoints: number }; vehicle: { make: string; model: string; plate: string };
  serviceJob?: { items: { name: string; price: number }[] } | null;
}
interface InvoiceRow { id: string; total: number; status: string; createdAt: string; customer: { name: string } }

export function Billing() {
  const { user } = useAuth();
  // ADMIN's only billing job is refund sign-off (on InvoiceDetail) -- it can't generate
  // invoices, so this panel (and its underlying /billing/billable, MANAGER/CASHIER-only
  // on the backend) is hidden rather than shown disabled or erroring.
  const canOperate = user?.role !== "ADMIN";
  const qc = useQueryClient();
  const { data: billable } = useQuery({ queryKey: ["billable"], queryFn: () => api.get<Billable[]>("/billing/billable"), enabled: canOperate });
  const { data: invoices } = useQuery({ queryKey: ["invoices"], queryFn: () => api.get<InvoiceRow[]>("/billing/invoices") });

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

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th></tr>
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
