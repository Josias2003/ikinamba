import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DateRangePicker, defaultDateRange, type DateRangeValue } from "../components/DateRangePicker";

interface CashierReport {
  since: string; until: string; invoicesCreated: number; totalCollected: number;
  paymentsByMethod: { method: string; amount: number }[];
  invoices: { id: string; createdAt: string; customer: string; vehicle: string; total: number; status: string; services: string[] }[];
  payments: { invoiceId: string; paidAt: string; customer: string; method: string; amount: number; status: string }[];
}
interface ReceptionistReport {
  since: string; until: string; appointmentCheckIns: number; walkInCheckIns: number;
  checkIns: { id: string; checkedInAt: string; source: string; customer: string; vehicle: string; plate: string; status: string; appointmentTime?: string | null }[];
}
interface TechnicianReport {
  since: string; until: string; jobsAssigned: number; jobsCompleted: number; avgServiceMinutes: number; qcSignOffs: number; revenueGenerated: number;
  jobs: {
    id: string; customer: string; vehicle: string; plate: string; status: string; checkedInAt: string; startedAt?: string | null;
    completedAt?: string | null; durationMinutes?: number | null; services: string[]; invoiceTotal?: number | null; invoiceStatus?: string | null;
  }[];
  qcSignOffDetails: { id: string; signedAt?: string | null; customer: string; vehicle: string; plate: string; status: string }[];
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <div className="font-mono text-2xl font-semibold text-ink-100 tabular-nums">{value}</div>
      <div className="panel-title mt-1">{label}</div>
    </div>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return <tr><td colSpan={colSpan} className="py-4 text-ink-400 text-center">{label}</td></tr>;
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

/** Each staff role's own performance/activity report -- CASHIER/RECEPTIONIST/TECHNICIAN
 * never had a meaningful report before this (only MANAGER/ADMIN had /reports). Backed by
 * GET /reports/my, which branches server-side on the caller's role. */
export function MyReport() {
  const { user } = useAuth();
  const [range, setRange] = useState<DateRangeValue>(defaultDateRange());
  const qs = `since=${range.since}&until=${range.until}`;
  const { data, isLoading } = useQuery({ queryKey: ["my-report", range], queryFn: () => api.get<any>(`/reports/my?${qs}`) });

  const header = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <DateRangePicker value={range} onChange={setRange} />
      <div className="flex items-center gap-2">
        <button className="btn-secondary text-xs" onClick={() => api.download(`/reports/my/export/excel?${qs}`, "my-report.xlsx")}><Download size={13} /> Excel</button>
        <button className="btn-secondary text-xs" onClick={() => api.download(`/reports/my/export/pdf?${qs}`, "my-report.pdf")}><Download size={13} /> PDF</button>
      </div>
    </div>
  );

  if (isLoading || !data) return <div className="space-y-6">{header}<p className="text-ink-400">Loading...</p></div>;

  if (user?.role === "CASHIER") {
    const r = data as CashierReport;
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 gap-4">
          <MetricCard label="Invoices created" value={String(r.invoicesCreated)} />
          <MetricCard label="Collected" value={`RWF ${Math.round(r.totalCollected).toLocaleString()}`} />
        </div>
        <div className="card">
          <h3 className="font-semibold text-ink-200 mb-3">Payments by method</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-ink-800">
              {r.paymentsByMethod.map((m) => (
                <tr key={m.method}><td className="py-2 text-ink-200">{m.method}</td><td className="py-2 text-right text-ink-400">RWF {Math.round(m.amount).toLocaleString()}</td></tr>
              ))}
              {!r.paymentsByMethod.length && <tr><td className="py-4 text-ink-400 text-center">No payments recorded yet in this window.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card !p-0 overflow-hidden">
          <h3 className="font-semibold text-ink-200 px-4 py-3">Payments recorded</h3>
          <table className="w-full text-sm">
            <thead className="bg-ink-950 text-ink-500 text-left">
              <tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Method</th><th className="px-4 py-3 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {r.payments.map((p) => (
                <tr key={`${p.invoiceId}-${p.paidAt}`}>
                  <td className="px-4 py-3 text-ink-500">{formatDateTime(p.paidAt)}</td>
                  <td className="px-4 py-3 text-ink-200">{p.customer}</td>
                  <td className="px-4 py-3">{p.method}</td>
                  <td className="px-4 py-3 text-right">RWF {Math.round(p.amount).toLocaleString()}</td>
                </tr>
              ))}
              {!r.payments.length && <EmptyRow colSpan={4} label="No payment rows in this window." />}
            </tbody>
          </table>
        </div>
        <div className="card !p-0 overflow-hidden">
          <h3 className="font-semibold text-ink-200 px-4 py-3">Invoices created</h3>
          <table className="w-full text-sm">
            <thead className="bg-ink-950 text-ink-500 text-left">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Services</th><th className="px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {r.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 text-ink-500">{formatDateTime(inv.createdAt)}</td>
                  <td className="px-4 py-3 text-ink-200">{inv.customer}</td>
                  <td className="px-4 py-3 text-ink-400">{inv.vehicle}</td>
                  <td className="px-4 py-3 text-ink-400">{inv.services.join(", ") || "-"}</td>
                  <td className="px-4 py-3 text-right">RWF {Math.round(inv.total).toLocaleString()}</td>
                </tr>
              ))}
              {!r.invoices.length && <EmptyRow colSpan={5} label="No invoice rows in this window." />}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (user?.role === "RECEPTIONIST") {
    const r = data as ReceptionistReport;
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 gap-4">
          <MetricCard label="Appointment check-ins" value={String(r.appointmentCheckIns)} />
          <MetricCard label="Walk-ins checked in" value={String(r.walkInCheckIns)} />
        </div>
        <div className="card !p-0 overflow-hidden">
          <h3 className="font-semibold text-ink-200 px-4 py-3">Check-in details</h3>
          <table className="w-full text-sm">
            <thead className="bg-ink-950 text-ink-500 text-left">
              <tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {r.checkIns.map((row) => (
                <tr key={`${row.id}-${row.checkedInAt}`}>
                  <td className="px-4 py-3 text-ink-500">{formatDateTime(row.checkedInAt)}</td>
                  <td className="px-4 py-3"><span className="badge bg-ink-800 text-ink-300">{row.source}</span></td>
                  <td className="px-4 py-3 text-ink-200">{row.customer}</td>
                  <td className="px-4 py-3 text-ink-400">{row.vehicle} - {row.plate}</td>
                  <td className="px-4 py-3 text-ink-400">{row.status}</td>
                </tr>
              ))}
              {!r.checkIns.length && <EmptyRow colSpan={5} label="No check-ins in this window." />}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (user?.role === "TECHNICIAN") {
    const r = data as TechnicianReport;
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard label="Jobs assigned" value={String(r.jobsAssigned)} />
          <MetricCard label="Jobs completed" value={String(r.jobsCompleted)} />
          <MetricCard label="Avg. service time" value={`${r.avgServiceMinutes}m`} />
          <MetricCard label="QC sign-offs" value={String(r.qcSignOffs)} />
          <MetricCard label="Revenue generated" value={`RWF ${Math.round(r.revenueGenerated).toLocaleString()}`} />
        </div>
        <div className="card !p-0 overflow-hidden">
          <h3 className="font-semibold text-ink-200 px-4 py-3">Job details</h3>
          <table className="w-full text-sm">
            <thead className="bg-ink-950 text-ink-500 text-left">
              <tr><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Services</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Duration</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {r.jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3 text-ink-200">{job.vehicle} - {job.plate}</td>
                  <td className="px-4 py-3 text-ink-400">{job.customer}</td>
                  <td className="px-4 py-3 text-ink-400">{job.services.join(", ") || "-"}</td>
                  <td className="px-4 py-3"><span className="badge bg-ink-800 text-ink-300">{job.status}</span></td>
                  <td className="px-4 py-3 text-right">{job.durationMinutes == null ? "-" : `${job.durationMinutes}m`}</td>
                </tr>
              ))}
              {!r.jobs.length && <EmptyRow colSpan={5} label="No assigned jobs in this window." />}
            </tbody>
          </table>
        </div>
        <div className="card !p-0 overflow-hidden">
          <h3 className="font-semibold text-ink-200 px-4 py-3">QC sign-off details</h3>
          <table className="w-full text-sm">
            <thead className="bg-ink-950 text-ink-500 text-left">
              <tr><th className="px-4 py-3">Signed at</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {r.qcSignOffDetails.map((row) => (
                <tr key={`${row.id}-${row.signedAt}`}>
                  <td className="px-4 py-3 text-ink-500">{formatDateTime(row.signedAt)}</td>
                  <td className="px-4 py-3 text-ink-200">{row.vehicle} - {row.plate}</td>
                  <td className="px-4 py-3 text-ink-400">{row.customer}</td>
                  <td className="px-4 py-3"><span className="badge bg-ink-800 text-ink-300">{row.status}</span></td>
                </tr>
              ))}
              {!r.qcSignOffDetails.length && <EmptyRow colSpan={4} label="No QC sign-offs in this window." />}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return <p className="text-ink-400">No report defined for this role.</p>;
}
