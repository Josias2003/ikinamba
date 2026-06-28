import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../lib/api";

/** Blocks every other route until a temp password (set by ADMIN on account creation) is
 * replaced -- intercepted in ProtectedRoute via user.mustChangePassword, not just a nicety
 * shown once on login. Reuses the same POST /auth/change-password endpoint Profile's
 * voluntary change uses; this is just a different, mandatory entry point to it. */
export function ChangePasswordRequired() {
  const { user, markPasswordChanged, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("New passwords don't match");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      markPasswordChanged();
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6 text-white">
          <KeyRound className="text-brand-400" size={32} />
          <div className="font-bold text-xl">Set a new password</div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4">
          <p className="text-sm text-ink-400">
            {user?.email} -- you're signing in with a temporary password. Choose a new one before continuing.
          </p>
          <div>
            <label className="label">Temporary password</label>
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
          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading && <Loader2 size={16} className="animate-spin" />} Change password
          </button>
          <button type="button" className="text-xs text-ink-400 hover:text-ink-200 w-full text-center" onClick={logout}>
            Log out instead
          </button>
        </form>
      </div>
    </div>
  );
}
