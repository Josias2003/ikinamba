import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff, Loader2, Save, KeyRound } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface Me { id: string; email: string; role: string; totpEnabled: boolean; name?: string | null; phone?: string | null; notifyEmail: boolean }
interface MfaSetup { secret: string; otpauth: string; qrDataUrl: string }

export function Profile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });

  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"idle" | "enabling" | "disabling">("idle");

  const startEnroll = useMutation({
    mutationFn: () => api.post<MfaSetup>("/auth/mfa/setup"),
    onSuccess: (data) => { setSetup(data); setMode("enabling"); setError(""); },
  });

  const verify = useMutation({
    mutationFn: () => api.post("/auth/mfa/verify", { code }),
    onSuccess: () => { setMode("idle"); setSetup(null); setCode(""); setError(""); refresh(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Invalid code"),
  });

  const disable = useMutation({
    mutationFn: () => api.post("/auth/mfa/disable", { code }),
    onSuccess: () => { setMode("idle"); setCode(""); setError(""); refresh(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Invalid code"),
  });

  if (!me) return <p className="text-ink-400">Loading...</p>;

  return (
    <div className="max-w-md space-y-5">
      <div className="card space-y-1">
        <span className="panel-title">Account</span>
        <div className="text-ink-100 font-medium">{me.email}</div>
        <span className="badge-live text-[10px]">{me.role}</span>
        {user?.role !== me.role && <p className="text-xs text-ink-500">Signed in as {user?.email}</p>}
      </div>

      <ProfileInfoForm me={me} onSaved={refresh} />

      <ChangePasswordForm />

      <NotificationPrefsForm me={me} onSaved={refresh} />

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="panel-title">Two-factor authentication</span>
          {me.totpEnabled ? (
            <span className="badge-done"><ShieldCheck size={12} /> Enabled</span>
          ) : (
            <span className="badge-neutral"><ShieldOff size={12} /> Disabled</span>
          )}
        </div>

        {mode === "idle" && (
          <>
            <p className="text-sm text-ink-400">
              {me.totpEnabled
                ? "Your account requires an authentication code at login."
                : "Add an authentication-app code requirement at login for extra security."}
            </p>
            {me.totpEnabled ? (
              <button className="btn-secondary" onClick={() => { setMode("disabling"); setError(""); }}>
                Disable 2FA
              </button>
            ) : (
              <button className="btn-primary" onClick={() => startEnroll.mutate()} disabled={startEnroll.isPending}>
                {startEnroll.isPending && <Loader2 size={14} className="animate-spin" />} Enable 2FA
              </button>
            )}
          </>
        )}

        {mode === "enabling" && setup && (
          <div className="space-y-3">
            <p className="text-sm text-ink-400">Scan this with your authenticator app, then enter the 6-digit code.</p>
            <img src={setup.qrDataUrl} alt="2FA QR code" className="bg-white rounded-sm p-2 mx-auto" width={180} height={180} />
            <p className="text-xs text-ink-500 text-center font-mono break-all">{setup.secret}</p>
            <input className="input" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
            {error && <p className="alert-danger">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={() => verify.mutate()} disabled={!code || verify.isPending}>
                {verify.isPending && <Loader2 size={14} className="animate-spin" />} Confirm
              </button>
              <button className="btn-secondary" onClick={() => { setMode("idle"); setSetup(null); setCode(""); setError(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === "disabling" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-400">Enter your current authentication code to confirm disabling 2FA.</p>
            <input className="input" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
            {error && <p className="alert-danger">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-danger flex-1" onClick={() => disable.mutate()} disabled={!code || disable.isPending}>
                {disable.isPending && <Loader2 size={14} className="animate-spin" />} Disable 2FA
              </button>
              <button className="btn-secondary" onClick={() => { setMode("idle"); setCode(""); setError(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileInfoForm({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [name, setName] = useState(me.name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  useEffect(() => { setName(me.name ?? ""); setPhone(me.phone ?? ""); }, [me.name, me.phone]);

  const save = useMutation({
    mutationFn: () => api.patch("/auth/me", { name: name || undefined, phone: phone || undefined }),
    onSuccess: onSaved,
  });

  return (
    <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <span className="panel-title">Profile information</span>
      <div>
        <label className="label">Full name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Not set" />
      </div>
      <div>
        <label className="label">Phone</label>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Not set" />
      </div>
      <button className="btn-primary" type="submit" disabled={save.isPending}>
        {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
      </button>
      {save.isSuccess && <p className="text-xs text-brand-400">Saved.</p>}
    </form>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const change = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword, newPassword }),
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setConfirm(""); setError(""); },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not change password"),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("New passwords don't match");
      return;
    }
    change.mutate();
  }

  return (
    <form className="card space-y-3" onSubmit={onSubmit}>
      <span className="panel-title flex items-center gap-2"><KeyRound size={14} /> Change password</span>
      <div>
        <label className="label">Current password</label>
        <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </div>
      <div>
        <label className="label">New password</label>
        <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
      </div>
      {error && <p className="alert-danger">{error}</p>}
      <button className="btn-primary" type="submit" disabled={change.isPending}>
        {change.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Change password
      </button>
      {change.isSuccess && <p className="text-xs text-brand-400">Password changed.</p>}
    </form>
  );
}

function NotificationPrefsForm({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const toggle = useMutation({
    mutationFn: (notifyEmail: boolean) => api.patch("/auth/me", { notifyEmail }),
    onSuccess: onSaved,
  });

  return (
    <div className="card space-y-2">
      <span className="panel-title">Notification preferences</span>
      <label className="flex items-center justify-between text-sm text-ink-200 cursor-pointer">
        <span>Receive system notification emails</span>
        <input
          type="checkbox"
          checked={me.notifyEmail}
          onChange={(e) => toggle.mutate(e.target.checked)}
          disabled={toggle.isPending}
          className="w-4 h-4"
        />
      </label>
      <p className="text-xs text-ink-500">
        Turn off if you'd rather not get emailed about system events tied to your account.
      </p>
    </div>
  );
}
