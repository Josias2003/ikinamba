import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Car, Loader2 } from "lucide-react";
import { useAuth, isTotpRequiredError } from "../context/AuthContext";
import { ApiError } from "../lib/api";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("vianew440@gmail.com");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password, totpCode || undefined);
      navigate("/");
    } catch (err) {
      if (isTotpRequiredError(err)) {
        setNeedsTotp(true);
        setError("Enter your 6-digit authentication code");
      } else {
        setError(err instanceof ApiError ? err.message : "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="flex items-center gap-2 justify-center mb-6 text-white hover:opacity-80 transition-opacity">
          <Car className="text-brand-400" size={32} />
          <div>
            <div className="font-bold text-2xl">New Class Car Wash</div>
            <div className="text-xs text-ink-400 text-center">IKINAMBA staff console</div>
          </div>
        </Link>

        <form onSubmit={onSubmit} className="card space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {needsTotp && (
            <div>
              <label className="label">Authentication code</label>
              <input className="input" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
            </div>
          )}
          {error && <p className="alert-danger">{error}</p>}
          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading && <Loader2 size={16} className="animate-spin" />} Log in
          </button>
          <p className="text-xs text-center">
            <Link to="/book" className="text-brand-400 hover:underline">
              Book a service without an account &rarr;
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
