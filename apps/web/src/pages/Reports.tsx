import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { DateRangePicker, defaultDateRange, type DateRangeValue } from "../components/DateRangePicker";

interface Metrics {
  revenueByDay: { date: string; total: number }[];
  servicePopularity: { name: string; count: number }[];
  peakHours: { hour: number; count: number }[];
  staffProductivity: { email: string; count: number }[];
  retention: { returning: number; oneTime: number; total: number };
  totalRevenue: number;
  vehiclesServiced: number;
  avgServiceMinutes: number;
  revenueDetails: {
    id: string; date: string; customer: string; vehicle: string; total: number; status: string; services: string[];
    payments: { method: string; amount: number; status: string }[];
  }[];
  vehicleDetails: {
    id: string; checkedInAt: string; completedAt?: string | null; customer: string; vehicle: string; plate: string;
    status: string; technician?: string | null; services: string[]; invoiceStatus?: string | null;
  }[];
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return <tr><td colSpan={colSpan} className="px-4 py-6 text-center text-ink-400">{label}</td></tr>;
}

export function Reports() {
  const { theme } = useTheme();
  // Recharts needs literal color strings, not Tailwind classes -- pick the grid-line
  // shade per theme so it stays subtle-but-visible against either background instead of
  // disappearing (light-on-dark works for dark mode, but would be near-invisible on a
  // light-mode white card).
  const gridStroke = theme === "dark" ? "#e3e8ea" : "#c3ccd1";
  const [range, setRange] = useState<DateRangeValue>(defaultDateRange());
  const { data } = useQuery({
    queryKey: ["reports-dashboard", range],
    queryFn: () => api.get<Metrics>(`/reports/dashboard?since=${range.since}&until=${range.until}`),
  });

  const exportQS = `since=${range.since}&until=${range.until}`;

  if (!data) return <p className="text-ink-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => api.download(`/reports/export/excel?${exportQS}`, "ikinamba-report.xlsx")}><Download size={14} /> Excel</button>
          <button className="btn-secondary" onClick={() => api.download(`/reports/export/pdf?${exportQS}`, "ikinamba-report.pdf")}><Download size={14} /> PDF</button>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-3">Revenue trend ({range.since} to {range.until})</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.revenueByDay}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="total" stroke="#13847a" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-semibold text-ink-200 mb-3">Service popularity</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.servicePopularity} layout="vertical" margin={{ left: 24 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#f59e0b" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="font-semibold text-ink-200 mb-3">Peak hours</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.peakHours}>
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(h) => `${h}:00`} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1ea696" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-3">Staff productivity</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-ink-800">
            {data.staffProductivity.map((s) => (
              <tr key={s.email}><td className="py-2">{s.email}</td><td className="py-2 text-right">{s.count} jobs</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card !p-0 overflow-hidden">
        <h3 className="font-semibold text-ink-200 px-4 py-3">Revenue details</h3>
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Services</th><th className="px-4 py-3 text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {data.revenueDetails.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-4 py-3 text-ink-500">{new Date(invoice.date).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-ink-200">{invoice.customer}</td>
                <td className="px-4 py-3 text-ink-400">{invoice.vehicle}</td>
                <td className="px-4 py-3 text-ink-400">{invoice.services.join(", ") || "-"}</td>
                <td className="px-4 py-3 text-right">RWF {Math.round(invoice.total).toLocaleString()}</td>
              </tr>
            ))}
            {!data.revenueDetails.length && <EmptyRow colSpan={5} label="No paid or partially paid invoices in this range." />}
          </tbody>
        </table>
      </div>

      <div className="card !p-0 overflow-hidden">
        <h3 className="font-semibold text-ink-200 px-4 py-3">Vehicles serviced</h3>
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left">
            <tr><th className="px-4 py-3">Check-in</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Technician</th><th className="px-4 py-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {data.vehicleDetails.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 text-ink-500">{new Date(entry.checkedInAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-200">{entry.vehicle} - {entry.plate}</td>
                <td className="px-4 py-3 text-ink-400">{entry.customer}</td>
                <td className="px-4 py-3 text-ink-400">{entry.technician ?? "Unassigned"}</td>
                <td className="px-4 py-3"><span className="badge bg-ink-800 text-ink-300">{entry.status}</span></td>
              </tr>
            ))}
            {!data.vehicleDetails.length && <EmptyRow colSpan={5} label="No vehicles were checked in during this range." />}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="card"><div className="font-mono text-xl font-semibold text-ink-100 tabular-nums">{data.retention.returning}</div><div className="panel-title mt-1">Returning customers</div></div>
        <div className="card"><div className="font-mono text-xl font-semibold text-ink-100 tabular-nums">{data.retention.oneTime}</div><div className="panel-title mt-1">One-time customers</div></div>
        <div className="card"><div className="font-mono text-xl font-semibold text-ink-100 tabular-nums">{data.avgServiceMinutes}m</div><div className="panel-title mt-1">Avg. service time</div></div>
      </div>
    </div>
  );
}
