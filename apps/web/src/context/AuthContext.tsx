import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, clearToken, getToken, setToken } from "../lib/api";

export type Role = "ADMIN" | "MANAGER" | "CASHIER" | "RECEPTIONIST" | "TECHNICIAN" | "CUSTOMER";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
  totpEnabled?: boolean;
  name?: string | null;
  phone?: string | null;
  notifyEmail?: boolean;
  mustChangePassword?: boolean;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => void;
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<CurrentUser>("/auth/me")
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string, totpCode?: string) {
    const result = await api.post<{ token: string; user: CurrentUser }>(
      "/auth/login",
      { email, password, totpCode },
      { auth: false }
    );
    setToken(result.token);
    setUser(result.user);
  }

  function logout() {
    // Best-effort -- the audit trail matters, but a failed/expired-token logout call
    // shouldn't block the user from clearing their local session.
    api.post("/auth/logout").catch(() => {});
    clearToken();
    setUser(null);
  }

  // Clears the forced-change gate locally right after a successful /auth/change-password
  // call, instead of requiring a full reload to re-fetch /auth/me.
  function markPasswordChanged() {
    setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, markPasswordChanged }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function isTotpRequiredError(err: unknown) {
  return err instanceof ApiError && err.status === 401 && err.message === "TOTP_REQUIRED";
}
