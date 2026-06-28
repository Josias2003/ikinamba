import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Printer, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { TrackingQrCard } from "../components/TrackingQrCard";
import { useAuth } from "../context/AuthContext";

interface InvoiceFull {
  id: string; subtotal: number; discountAmount: number; loyaltyValueApplied: number; total: number; status: string;
  customer: { name: string; phone: string };
  items: { id: string; description: string; price: number; qty: number }[];
  payments: { id: string; method: string; amount: number; status: string; createdAt: string }[];
  queueEntry: { trackingToken: string } | null;
}

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  // Recording a payment is CASHIER's own named job -- blocked on the backend for every
  // other role (including MANAGER, which doesn't duplicate it), so the form is hidden
  // rather than shown disabled or erroring on submit.
  const canRecordPayment = user?.role === "CASHIER";
  // Refund is ADMIN's financial-control sign-off action only.
  const canRefund = user?.role === "ADMIN";
  const qc = useQueryClient();
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState<number | "">("");

  const { data: invoice, isLoading, isError } = useQuery({ queryKey: ["invoice", id], queryFn: () => api.get<InvoiceFull>(`/billing/invoices/${id}`) });

  const pay = useMutation({
    mutationFn: () => api.post(`/billing/invoices/${id}/payments`, { method, amount: Number(amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoice", id] }); setAmount(""); },
  });
  const refund = useMutation({ mutationFn: () => api.post(`/billing/invoices/${id}/refund`), onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice", id] }) });

  if (isLoading) return <p className="text-ink-400">Loading...</p>;
  if (isError || !invoice) {
    return (
      <div className="max-w-xl space-y-3">
        <p className="alert-danger">Couldn't load this invoice -- it may not exist or you may not have access.</p>
        <Link to="/billing" className="text-brand-400 hover:underline text-sm">&larr; Back to Billing</Link>
      </div>
    );
  }
  const paid = invoice.payments.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount, 0);
  const balance = invoice.total - paid;

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center justify-end">
        <button className="btn-secondary text-xs" onClick={() => window.print()}><Printer size={14} /> Print receipt</button>
      </div>

      <div id="printable-receipt" className="space-y-5">
      <div className="card space-y-1">
        <p className="font-medium">{invoice.customer.name}</p>
        <p className="text-sm text-ink-500">{invoice.customer.phone}</p>
      </div>

      <div className="card">
        <table className="w-full text-sm mb-3">
          <tbody className="divide-y divide-ink-800">
            {invoice.items.map((i) => (
              <tr key={i.id}><td className="py-1.5">{i.description}</td><td className="py-1.5 text-right">RWF {i.price.toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="text-sm space-y-1 border-t border-ink-800 pt-2">
          <div className="flex justify-between"><span>Subtotal</span><span>RWF {invoice.subtotal.toLocaleString()}</span></div>
          {invoice.discountAmount > 0 && <div className="flex justify-between text-ink-500"><span>Discount</span><span>-RWF {invoice.discountAmount.toLocaleString()}</span></div>}
          {invoice.loyaltyValueApplied > 0 && <div className="flex justify-between text-ink-500"><span>Loyalty points applied</span><span>-RWF {invoice.loyaltyValueApplied.toLocaleString()}</span></div>}
          <div className="flex justify-between font-semibold text-ink-100"><span>Total</span><span>RWF {invoice.total.toLocaleString()}</span></div>
          <div className="flex justify-between text-brand-300"><span>Balance due</span><span>RWF {balance.toLocaleString()}</span></div>
        </div>
        <span className="badge bg-ink-800 text-ink-300 mt-2">{invoice.status}</span>
      </div>

      {invoice.queueEntry && (
        <div className="card">
          <TrackingQrCard token={invoice.queueEntry.trackingToken} caption="Scan to view this visit's service history." />
        </div>
      )}
      </div>

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-2">Payments</h3>
        <div className="space-y-1 mb-3">
          {invoice.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm">
              <span>{p.method}</span><span className={p.status === "SUCCESS" ? "badge-done" : "badge-danger"}>{p.status}</span><span>RWF {p.amount.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {canRecordPayment && balance > 0 && invoice.status !== "REFUNDED" && (
          <div className="flex gap-2">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="MOMO">MTN MoMo</option>
              <option value="AIRTEL">Airtel Money</option>
              <option value="CARD">Card</option>
            </select>
            <input className="input" type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} />
            <button className="btn-primary" disabled={!amount || pay.isPending} onClick={() => pay.mutate()}>Pay</button>
          </div>
        )}
        {canRecordPayment && pay.isError && <p className="alert-danger mt-2">{(pay.error as any)?.message}</p>}

        {canRefund && invoice.status === "PAID" && (
          <button className="btn-danger text-xs mt-3" onClick={() => refund.mutate()} disabled={refund.isPending}>
            {refund.isPending && <Loader2 size={13} className="animate-spin" />} Refund
          </button>
        )}
      </div>
    </div>
  );
}
