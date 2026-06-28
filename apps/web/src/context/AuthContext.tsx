import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, clearToken, getToken, setToken } from "../lib/api";

export type Role = "ADMIN" | "MANAGER" | "CASHIER" | "RECEPTIONIST" | "TECHNICIAN" | "CUSTOMER";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  customerId: string | null;
  totpEnabled?: boolean;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => void;
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
    clearToken();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function isTotpRequiredError(err: unknown) {
  return err instanceof ApiError && err.status === 401 && err.message === "TOTP_REQUIRED";
}
