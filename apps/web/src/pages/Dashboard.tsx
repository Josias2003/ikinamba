import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Car, ArrowUpRight, Receipt } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { NAV_GROUPS } from "../components/Layout";
import { api } from "../lib/api";
import { socket } from "../lib/socket";

interface DashboardMetrics {
  totalRevenue: number;
  vehiclesServiced: number;
  avgServiceMinutes: number;
  retention: { returning: number; oneTime: number; total: number };
}
interface Entry {
  id: string;
  status: string;
  checkedInAt: string;
  startedAt: string | null;
  trackingToken: string;
  customer: { name: string };
  vehicle: { make: string; model: string; plate: string };
}
interface Bay {
  id: string;
  name: string;
  status: string;
  queueEntries: Entry[];
}
interface Board {
  bays: Bay[];
  waiting: Entry[];
}
interface BillableEntry { id: string }

// ADMIN doesn't run the floor or do day-to-day billing (real per-role separation) -- it's
// redirected away from this page entirely (see App.tsx), kept here only for consistency.
const QUEUE_ROLES = ["MANAGER", "RECEPTIONIST", "TECHNICIAN"];
const REPORT_ROLES = ["ADMIN", "MANAGER"];
const BILLABLE_ROLES = ["MANAGER", "CASHIER"];

function elapsedSince(iso: string | null, now: number) {
  if (!iso) return "--:--";
  const ms = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function BayTile({ bay, now }: { bay: Bay; now: number }) {
  const entry = bay.queueEntries[0];
  const occupied = bay.status === "OCCUPIED";
  const maintenance = bay.status === "MAINTENANCE";

  return (
    <div
      className={`card relative overflow-hidden ${
        occupied ? "border-brand-500/40" : maintenance ? "border-red-500/40" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">{bay.name}</span>
        <span
          className={
            occupied ? "status-dot-live" : maintenance ? "status-dot-off" : "status-dot-idle"
          }
        />
      </div>

      {entry ? (
        <div className="space-y-2">
          <div className="font-mono text-2xl font-semibold text-ink-100 tabular-nums">
            {elapsedSince(entry.startedAt, now)}
          </div>
          <div className="flex items-center gap-2 text-sm text-ink-200">
            <Car size={14} className="text-brand-400" />
            {entry.vehicle.make} {entry.vehicle.model} &middot; {entry.vehicle.plate}
          </div>
          <div className="text-xs text-ink-500">{entry.customer.name}</div>
          <span className={entry.status === "QUALITY_CHECK" ? "badge-warn" : "badge-live"}>
            {entry.status.replace("_", " ")}
          </span>
        </div>
      ) : (
        <div className="py-6 text-center">
          <span className="text-xs font-mono uppercase tracking-widest text-ink-600">
            {maintenance ? "Out of service" : "Idle"}
          </span>
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3 flex flex-col">
      <span className="panel-title mb-1">{label}</span>
      <span className="font-mono text-xl font-semibold text-ink-100 tabular-nums">{value}</span>
    </div>
  );
}

function DashboardEntryList({ title, entries, now }: { title: string; entries: Entry[]; now: number }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">{title}</span>
        <span className="font-mono text-xs text-ink-500">{entries.length}</span>
      </div>
      <div className="space-y-1.5">
        {entries.slice(0, 8).map((entry, i) => (
          <div key={entry.id} className="flex items-center gap-3 text-sm border border-ink-800 rounded-sm px-3 py-2">
            <span className="font-mono text-ink-600 w-5">{String(i + 1).padStart(2, "0")}</span>
            <span className="flex-1 text-ink-200">{entry.vehicle.make} {entry.vehicle.model} - {entry.vehicle.plate}</span>
            <span className="text-ink-500 text-xs">{entry.customer.name}</span>
            <span className="badge bg-ink-800 text-ink-300">{entry.status.replace("_", " ")}</span>
            <span className="font-mono text-xs text-ink-500">{elapsedSince(entry.startedAt ?? entry.checkedInAt, now)}</span>
          </div>
        ))}
        {!entries.length && <p className="text-ink-400 text-sm">No vehicles in this group.</p>}
      </div>
      {entries.length > 8 && (
        <Link to="/queue" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 mt-3">
          View all <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  const canSeeQueue = QUEUE_ROLES.includes(user?.role ?? "");
  const canSeeReports = REPORT_ROLES.includes(user?.role ?? "");
  const canSeeBillable = BILLABLE_ROLES.includes(user?.role ?? "");

  const { data: metrics } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: () => api.get<DashboardMetrics>("/reports/dashboard?days=30"),
    enabled: canSeeReports,
  });

  const { data: board } = useQuery({
    queryKey: ["queue-board"],
    queryFn: () => api.get<Board>("/queue/board"),
    enabled: canSeeQueue,
  });

  const { data: billable } = useQuery({
    queryKey: ["billable"],
    queryFn: () => api.get<BillableEntry[]>("/billing/billable"),
    enabled: canSeeBillable,
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!canSeeQueue) return;
    socket.connect();
    socket.emit("join:queueBoard");
    const refresh = () => qc.invalidateQueries({ queryKey: ["queue-board"] });
    socket.on("queueBoard:update", refresh);
    return () => {
      socket.off("queueBoard:update", refresh);
      socket.disconnect();
    };
  }, [canSeeQueue, qc]);

  // Every other section this role can reach, beyond this Floor page itself -- this is the
  // home screen's "launchpad" half. An ADMIN's home otherwise looked identical to a
  // TECHNICIAN's (just the bay floor), with no way to see at a glance that the account
  // can also run billing, bookings, inventory, etc. -- this row makes that breadth visible
  // instead of requiring a trip through the sidebar to discover it.
  const quickAccess = NAV_GROUPS.flatMap((g) => g.items).filter(
    (item) => item.to !== "/" && user && item.roles.includes(user.role)
  );

  const occupiedBays = board?.bays.filter((b) => b.status === "OCCUPIED").length ?? 0;
  const allEntries = board?.bays.flatMap((b) => b.queueEntries) ?? [];
  const inServiceCount = allEntries.filter((e) => e.status === "IN_SERVICE").length;
  const inQcCount = allEntries.filter((e) => e.status === "QUALITY_CHECK").length;
  const activeFloorEntries = allEntries.filter((e) => ["IN_SERVICE", "QUALITY_CHECK"].includes(e.status));

  return (
    <div className="space-y-6">
      {(canSeeReports || canSeeBillable) && (
        <div className="card p-0 flex flex-wrap divide-x divide-ink-800">
          {canSeeReports && metrics && (
            <>
              <MetricCell label="Revenue / 30d" value={`RWF ${Math.round(metrics.totalRevenue).toLocaleString()}`} />
              <MetricCell label="Vehicles / 30d" value={String(metrics.vehiclesServiced)} />
              <MetricCell label="Avg. service" value={`${metrics.avgServiceMinutes}m`} />
              <MetricCell label="Returning" value={`${metrics.retention.returning}/${metrics.retention.total}`} />
            </>
          )}
          {canSeeBillable && billable && <MetricCell label="Ready to invoice" value={String(billable.length)} />}
        </div>
      )}

      {canSeeQueue && board && (
        <>
          {/* "What is happening right now" at a glance -- the financial metrics row above
              is gated to MANAGER/ADMIN's oversight numbers; the day-to-day floor roles
              (RECEPTIONIST/TECHNICIAN) saw nothing here at all before this, just bay tiles
              with no summary, which read as an empty page rather than a working dashboard. */}
          <div className="card p-0 flex flex-wrap divide-x divide-ink-800">
            <MetricCell label="Bays occupied" value={`${occupiedBays}/${board.bays.length}`} />
            <MetricCell label="Vehicles waiting" value={String(board.waiting.length)} />
            <MetricCell label="In service" value={String(inServiceCount)} />
            <MetricCell label="In quality check" value={String(inQcCount)} />
          </div>

          <div className="flex items-center justify-between">
            <span className="panel-title">Bay floor &middot; live</span>
            <Link to="/queue" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
              Full queue board <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {board.bays.map((bay) => <BayTile key={bay.id} bay={bay} now={now} />)}
          </div>
          {!board.bays.length && <p className="text-ink-500 text-sm">No bays configured yet.</p>}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <DashboardEntryList title="Active floor list" entries={activeFloorEntries} now={now} />
            <DashboardEntryList title="Waiting queue list" entries={board.waiting} now={now} />
          </div>

        </>
      )}

      {canSeeBillable && billable && billable.length > 0 && (
        <Link to="/billing" className="card flex items-center justify-between hover:border-brand-500/40 transition-colors">
          <div className="flex items-center gap-3">
            <Receipt size={18} className="text-brand-400" />
            <span className="text-sm text-ink-200">{billable.length} completed job{billable.length === 1 ? "" : "s"} ready to invoice</span>
          </div>
          <ArrowUpRight size={16} className="text-ink-500" />
        </Link>
      )}

      {quickAccess.length > 0 && (
        <div>
          <span className="panel-title">Quick access</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
            {quickAccess.map(({ to, label, icon: Icon }, i) => {
              // The role's primary day-to-day page (first in NAV_GROUPS order) gets visual
              // weight instead of every card competing equally for attention -- the rest
              // stay as plain secondary shortcuts.
              const primary = i === 0;
              return (
                <Link
                  key={to}
                  to={to}
                  className={`card flex items-center justify-between hover:border-brand-500/40 transition-colors ${
                    primary ? "sm:col-span-2 lg:col-span-1 border-brand-500/40 bg-brand-500/5 py-6" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={primary ? 22 : 18} className="text-brand-400" />
                    <span className={primary ? "text-base font-semibold text-ink-100" : "text-sm font-medium text-ink-100"}>{label}</span>
                  </div>
                  <ArrowUpRight size={primary ? 18 : 16} className="text-ink-500" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
