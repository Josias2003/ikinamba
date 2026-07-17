import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import { Pagination } from "../components/Pagination";

interface User { id: string; email: string; role: string; isActive: boolean; totpEnabled: boolean }
interface AuditEntry {
  id: string; action: string; entity: string; entityId?: string; category: string; severity: string;
  createdAt: string; user?: { email: string } | null; metadata?: string | null;
}
interface Paged<T> { data: T[]; total: number; page: number; pageSize: number }

const ROLES = ["ADMIN", "MANAGER", "CASHIER", "RECEPTIONIST", "TECHNICIAN"];
const ROLE_FILTERS = ["ALL", ...ROLES];
const CATEGORIES = ["ALL", "AUTH", "BILLING", "INVENTORY", "USER_MGMT", "QUEUE", "CUSTOMER", "MAINTENANCE", "OTHER"];
const SEVERITY_BADGE: Record<string, string> = { INFO: "badge-done", WARNING: "badge-warn", DANGER: "badge-danger" };

/** Audit metadata is a JSON blob written by various route handlers -- one malformed
 * entry shouldn't crash the whole log render. */
function safeMetadataEmail(metadata?: string | null): string {
  if (!metadata) return "unknown";
  try {
    return JSON.parse(metadata).email ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function Users() {
  const qc = useQueryClient();
  const [category, setCategory] = useState("ALL");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logPage, setLogPage] = useState(1);
  const logPageSize = 25;
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");

  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const logQs = new URLSearchParams({
    category, since, until, page: String(logPage), pageSize: String(logPageSize),
    ...(logSearch ? { search: logSearch } : {}),
  });
  const { data: logData } = useQuery({
    queryKey: ["audit-log", category, since, until, logPage, logSearch],
    queryFn: () => api.get<Paged<AuditEntry>>(`/users/audit-log?${logQs.toString()}`),
  });
  const auditLog = logData?.data;
  const [showForm, setShowForm] = useState(false);

  const create = useMutation({ mutationFn: (body: any) => api.post("/users", body), onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setShowForm(false); } });
  const deactivate = useMutation({ mutationFn: (id: string) => api.patch(`/users/${id}/deactivate`), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  const reactivate = useMutation({ mutationFn: (id: string) => api.patch(`/users/${id}/reactivate`), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });

  const visibleUsers = useMemo(() => {
    if (!users) return users;
    const term = userSearch.trim().toLowerCase();
    return users.filter((u) => (roleFilter === "ALL" || u.role === roleFilter) && (!term || u.email.toLowerCase().includes(term)));
  }, [users, userSearch, roleFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-2.5 text-ink-400" size={16} />
            <input className="input pl-9" placeholder="Search email..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          </div>
          <select className="input w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            {ROLE_FILTERS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> New user</button>
      </div>

      {showForm && <NewUserForm onClose={() => setShowForm(false)} onSubmit={(b) => create.mutate(b)} />}

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">MFA</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-ink-800">
            {!visibleUsers?.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-400">No users match this filter.</td></tr>
            )}
            {visibleUsers?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3"><span className="badge bg-brand-500/10 text-brand-300">{u.role}</span></td>
                <td className="px-4 py-3 text-ink-500">{u.totpEnabled ? "Enabled" : "Off"}</td>
                <td className="px-4 py-3">{u.isActive ? <span className="badge-done">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td className="px-4 py-3">
                  {u.isActive ? (
                    <button className="btn-secondary text-xs" onClick={() => deactivate.mutate(u.id)} disabled={deactivate.isPending}>Deactivate</button>
                  ) : (
                    <button className="btn-secondary text-xs" onClick={() => reactivate.mutate(u.id)} disabled={reactivate.isPending}>Reactivate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-ink-200">Audit log</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 text-ink-400" size={13} />
              <input className="input pl-7 w-auto text-xs py-1" placeholder="Search action/user/entity..." value={logSearch} onChange={(e) => { setLogSearch(e.target.value); setLogPage(1); }} />
            </div>
            <select className="input w-auto text-xs py-1" value={category} onChange={(e) => { setCategory(e.target.value); setLogPage(1); }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="input w-auto text-xs py-1" type="date" value={since} onChange={(e) => { setSince(e.target.value); setLogPage(1); }} />
            <span className="text-ink-500 text-xs">to</span>
            <input className="input w-auto text-xs py-1" type="date" value={until} onChange={(e) => { setUntil(e.target.value); setLogPage(1); }} />
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {auditLog?.map((a) => (
            <div key={a.id} className="text-xs flex items-center gap-2 text-ink-400 border-b border-ink-800 py-1.5">
              <span className={SEVERITY_BADGE[a.severity] ?? "badge-neutral"}>{a.severity}</span>
              <span className="text-ink-400 w-36 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
              <span className="w-40 shrink-0 truncate">{a.user?.email ?? (a.action === "FAILED_LOGIN" ? safeMetadataEmail(a.metadata) : "system")}</span>
              <span className="font-medium">{a.action}</span>
              <span className="text-ink-400">{a.entity} {a.entityId?.slice(0, 8)}</span>
            </div>
          ))}
          {!auditLog?.length && <p className="text-ink-500 text-sm py-2">No entries match this filter.</p>}
        </div>
        {logData && <div className="mt-3"><Pagination page={logData.page} pageSize={logData.pageSize} total={logData.total} onPageChange={setLogPage} /></div>}
      </div>
    </div>
  );
}

function NewUserForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (b: any) => void }) {
  const [form, setForm] = useState({ email: "", password: "", role: "RECEPTIONIST" });
  return (
    <form className="card grid grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
      <div><label className="label">Email</label><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div><label className="label">Temp password</label><input className="input" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div>
        <label className="label">Role</label>
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="col-span-3 flex gap-2"><button className="btn-primary" type="submit">Create</button><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button></div>
    </form>
  );
}
