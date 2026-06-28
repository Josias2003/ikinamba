import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, CalendarCheck, LayoutGrid, Wrench, Receipt, BarChart3,
  Package, ShieldCheck, Sparkles, LogOut, Car, Sun, Moon, ClipboardList, type LucideIcon,
} from "lucide-react";
import { useAuth, type Role } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { ChatWidget } from "./ChatWidget";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}
export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

// Two-level IA: a PRIMARY nav of task areas (Floor / People / Money / Admin), and a
// SECONDARY nav of the pages inside whichever area is currently active.
//
// Each item's `roles` reflects REAL per-role separation, not seniority inheritance --
// ADMIN is deliberately absent from Floor/People/day-to-day Money items even though it
// could reach them in the old model. ADMIN's own job is system administration
// (Users & audit log), financial-control sign-off (refund/PO-approve, both inside the
// Billing/Inventory pages but gated to those two actions at the API), and business
// oversight (Reports/AI insights, view-only -- MANAGER does the operational side, e.g.
// recompute). See [[project-kariza-roles-separation]] for the full reasoning + matrix.
// Mirrors the backend's requireRole(...) per route -- see the route files under
// apps/server/src/routes/.
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "floor",
    label: "Floor",
    icon: LayoutDashboard,
    items: [
      { to: "/", label: "Live floor", icon: LayoutDashboard, roles: ["MANAGER", "CASHIER", "RECEPTIONIST", "TECHNICIAN"] },
      { to: "/queue", label: "Queue & bays", icon: LayoutGrid, roles: ["MANAGER", "RECEPTIONIST", "TECHNICIAN"] },
      { to: "/appointments", label: "Bookings", icon: CalendarCheck, roles: ["MANAGER", "RECEPTIONIST"] },
      { to: "/maintenance", label: "Service & inspections", icon: Wrench, roles: ["MANAGER", "TECHNICIAN"] },
    ],
  },
  {
    id: "people",
    label: "People",
    icon: Users,
    items: [
      { to: "/customers", label: "Customers & vehicles", icon: Users, roles: ["MANAGER", "RECEPTIONIST", "CASHIER", "TECHNICIAN"] },
    ],
  },
  {
    id: "money",
    label: "Money",
    icon: Receipt,
    items: [
      // ADMIN keeps these two pages so it has somewhere to exercise its financial-control
      // actions (refund / PO approval) -- every create/adjust/operate button on them is
      // hidden for ADMIN specifically, see Billing.tsx / InvoiceDetail.tsx / Inventory.tsx.
      { to: "/billing", label: "Billing & invoices", icon: Receipt, roles: ["MANAGER", "CASHIER", "ADMIN"] },
      { to: "/inventory", label: "Stock & purchase orders", icon: Package, roles: ["MANAGER", "ADMIN"] },
      { to: "/reports", label: "Reports & analytics", icon: BarChart3, roles: ["MANAGER", "ADMIN"] },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: ShieldCheck,
    items: [
      { to: "/ai", label: "AI insights", icon: Sparkles, roles: ["MANAGER", "ADMIN"] },
      // ADMIN-exclusive -- reverted from a brief MANAGER-can-manage-staff experiment
      // per explicit feedback: "let admin do the admin role, not give it to manager."
      { to: "/users", label: "Users & audit log", icon: ShieldCheck, roles: ["ADMIN"] },
    ],
  },
  {
    // Separate from "admin" -- CASHIER/RECEPTIONIST/TECHNICIAN should never see a
    // primary nav icon labeled "Admin" just to reach their own report.
    id: "my-report",
    label: "Reports",
    icon: ClipboardList,
    items: [
      { to: "/my-report", label: "My report", icon: ClipboardList, roles: ["CASHIER", "RECEPTIONIST", "TECHNICIAN"] },
    ],
  },
];

function matchesItem(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const now = useClock();

  // Secondary nav is a hover/focus flyout off the primary icon, not a permanent column --
  // closeTimer gives a short grace period so moving the mouse diagonally from the icon
  // into the flyout doesn't close it before it's reached.
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  function openFlyout(id: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHoveredGroupId(id);
  }
  function scheduleCloseFlyout() {
    closeTimer.current = setTimeout(() => setHoveredGroupId(null), 200);
  }

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => user && i.roles.includes(user.role)) })).filter(
        (g) => g.items.length > 0
      ),
    [user]
  );

  const activeGroup =
    visibleGroups.find((g) => g.items.some((i) => matchesItem(location.pathname, i.to))) ?? visibleGroups[0];
  const activeItem = activeGroup?.items.find((i) => matchesItem(location.pathname, i.to));

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-ink-950 bg-grid bg-[length:26px_26px]">
      {/* Primary nav: task areas only -- one icon per area, not per page. Fixed to the
          viewport so it never scrolls away with page content, regardless of how tall
          any given page's content gets. */}
      <aside className="fixed inset-y-0 left-0 w-16 z-40 bg-ink-950 border-r border-ink-800 flex flex-col items-center">
        <div className="h-16 flex items-center justify-center border-b border-ink-800 w-full">
          <Car className="text-brand-400" size={22} />
        </div>
        <nav className="flex-1 w-full py-3 flex flex-col items-center gap-2">
          {visibleGroups.map((group) => {
            const isActive = group.id === activeGroup?.id;
            const isOpen = hoveredGroupId === group.id && group.items.length > 1;
            return (
              <div
                key={group.id}
                className="relative w-12"
                onMouseEnter={() => openFlyout(group.id)}
                onMouseLeave={scheduleCloseFlyout}
                onFocus={() => openFlyout(group.id)}
                onBlur={scheduleCloseFlyout}
              >
                <button
                  title={group.label}
                  onClick={() => navigate(group.items[0].to)}
                  className={`w-12 flex flex-col items-center gap-1 rounded-sm py-2 text-[9px] font-mono uppercase tracking-wide transition-colors border-l-2 ${
                    isActive
                      ? "border-brand-400 bg-brand-500/10 text-brand-300"
                      : "border-transparent text-ink-400 hover:text-ink-100 hover:bg-ink-800/60"
                  }`}
                >
                  <group.icon size={18} />
                  {group.label}
                </button>

                {/* Secondary nav: a flyout next to the hovered icon, not a permanent
                    column -- omitted for single-item groups since a one-entry submenu is
                    just noise (the icon's own click already goes straight there). */}
                {isOpen && (
                  <div
                    className="absolute left-full top-0 ml-2 w-48 bg-ink-950 border border-ink-800 rounded-sm shadow-card py-2 z-50"
                    onMouseEnter={() => openFlyout(group.id)}
                    onMouseLeave={scheduleCloseFlyout}
                  >
                    <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500 px-3 mb-1">
                      {group.label}
                    </div>
                    <nav className="flex flex-col gap-0.5 px-1">
                      {group.items.map(({ to, label, icon: Icon }) => (
                        <NavLink
                          key={to}
                          to={to}
                          end={to === "/"}
                          onClick={() => setHoveredGroupId(null)}
                          className={({ isActive: itemActive }) =>
                            `flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors ${
                              itemActive ? "bg-brand-500/10 text-brand-300" : "text-ink-300 hover:bg-ink-800/60 hover:text-ink-100"
                            }`
                          }
                        >
                          <Icon size={15} />
                          {label}
                        </NavLink>
                      ))}
                    </nav>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        {/* aside is `fixed inset-y-0` (full viewport height), so this stays visible at
            the bottom of the rail without ever needing to scroll to reach it. */}
        <button
          onClick={() => { logout(); navigate("/login"); }}
          title="Log out"
          className="w-12 mb-4 flex flex-col items-center gap-1 rounded-sm py-2 text-[9px] font-mono uppercase tracking-wide text-ink-500 hover:text-red-400 hover:bg-red-500/10"
        >
          <LogOut size={16} />
          Exit
        </button>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 ml-16">
        {/* Console status bar -- fixed like the side rail so it never scrolls away with
            page content, regardless of how tall any given page gets. */}
        <header className="fixed top-0 left-16 right-0 z-30 h-16 border-b border-ink-800 bg-ink-950/80 backdrop-blur flex items-center justify-between px-6">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.15em]">
            <span className="text-ink-500">IKINAMBA</span>
            <span className="text-ink-700">/</span>
            <span className="text-ink-400">{activeGroup?.label}</span>
            {activeGroup && activeGroup.items.length > 1 && (
              <>
                <span className="text-ink-700">/</span>
                <span className="text-ink-100">{activeItem?.label ?? ""}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-5">
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="text-ink-400 hover:text-ink-100 hover:bg-ink-800/60 rounded-sm p-1.5 transition-colors"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <span className="font-mono text-sm text-ink-400 tabular-nums hidden sm:inline">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <div className="h-6 w-px bg-ink-800 hidden sm:block" />
            <Link to="/profile" className="text-right hover:opacity-80 transition-opacity" title="Profile & security">
              <div className="text-xs text-ink-300 leading-tight">{user.email}</div>
              <div className="badge-live text-[10px]">{user.role}</div>
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto mt-16">
          <div className="max-w-7xl mx-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>

      <ChatWidget />
    </div>
  );
}
