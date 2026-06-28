import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../lib/api";

interface User { id: string; email: string; role: string; isActive: boolean; totpEnabled: boolean }
interface AuditEntry { id: string; action: string; entity: string; entityId?: string; createdAt: string; user?: { email: string } | null }

const ROLES = ["ADMIN", "MANAGER", "CASHIER", "RECEPTIONIST", "TECHNICIAN"];

export function Users() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/users") });
  const { data: auditLog } = useQuery({ queryKey: ["audit-log"], queryFn: () => api.get<AuditEntry[]>("/users/audit-log") });
  const [showForm, setShowForm] = useState(false);

  const create = useMutation({ mutationFn: (body: any) => api.post("/users", body), onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setShowForm(false); } });
  const deactivate = useMutation({ mutationFn: (id: string) => api.patch(`/users/${id}/deactivate`), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> New user</button>
      </div>

      {showForm && <NewUserForm onClose={() => setShowForm(false)} onSubmit={(b) => create.mutate(b)} />}

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-950 text-ink-500 text-left"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">MFA</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-ink-800">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3"><span className="badge bg-brand-500/10 text-brand-300">{u.role}</span></td>
                <td className="px-4 py-3 text-ink-500">{u.totpEnabled ? "Enabled" : "Off"}</td>
                <td className="px-4 py-3">{u.isActive ? <span className="badge-done">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td className="px-4 py-3">{u.isActive && <button className="btn-secondary text-xs" onClick={() => deactivate.mutate(u.id)}>Deactivate</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="font-semibold text-ink-200 mb-3">Audit log</h3>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {auditLog?.map((a) => (
            <div key={a.id} className="text-xs flex gap-2 text-ink-400 border-b border-ink-800 py-1">
              <span className="text-ink-400 w-36 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
              <span className="w-32 shrink-0">{a.user?.email ?? "system"}</span>
              <span className="font-medium">{a.action}</span>
              <span className="text-ink-400">{a.entity} {a.entityId?.slice(0, 8)}</span>
            </div>
          ))}
        </div>
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
