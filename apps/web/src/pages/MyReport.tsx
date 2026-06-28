import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DateRangePicker, defaultDateRange, type DateRangeValue } from "../components/DateRangePicker";

interface CashierReport { since: string; until: string; invoicesCreated: number; totalCollected: number; paymentsByMethod: { method: string; amount: number }[] }
interface ReceptionistReport { since: string; until: string; appointmentCheckIns: number; walkInCheckIns: number }
interface TechnicianReport { since: string; until: string; jobsAssigned: number; jobsCompleted: number; avgServiceMinutes: number; qcSignOffs: number; revenueGenerated: number }

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <div className="font-mono text-2xl font-semibold text-ink-100 tabular-nums">{value}</div>
      <div className="panel-title mt-1">{label}</div>
    </div>
  );
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
      </div>
    );
  }

  return <p className="text-ink-400">No report defined for this role.</p>;
}
