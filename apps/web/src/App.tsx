import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Customers } from "./pages/Customers";
import { CustomerDetail } from "./pages/CustomerDetail";
import { Appointments } from "./pages/Appointments";
import { BookingPublic } from "./pages/BookingPublic";
import { QueueBoard } from "./pages/QueueBoard";
import { Maintenance } from "./pages/Maintenance";
import { TrackingPublic } from "./pages/TrackingPublic";
import { Billing } from "./pages/Billing";
import { InvoiceDetail } from "./pages/InvoiceDetail";
import { Reports } from "./pages/Reports";
import { Inventory } from "./pages/Inventory";
import { Users } from "./pages/Users";
import { AIInsights } from "./pages/AIInsights";
import { NotFound } from "./pages/NotFound";

// Mirrors the backend's per-route requireRole(...) exactly (see
// docs/thesis/05-api-reference.md) -- nav hiding a link is a UX nicety, not access
// control. Without a route-level guard here, any logged-in staff member could type
// /users or /inventory straight into the address bar and the page would render (and then
// 403 against the API) instead of being redirected.
//
// Real per-role separation, not seniority inheritance: ADMIN is NOT included on
// Floor/People/day-to-day Money routes just because MANAGER is. ADMIN keeps /billing and
// /inventory (its only actions there are refund/PO-approve) and the oversight pages
// (/reports, /ai, /users). See [[project-kariza-roles-separation]].
function Home() {
  const { user } = useAuth();
  // ADMIN doesn't run the floor, so its landing page is the oversight dashboard instead.
  if (user?.role === "ADMIN") return <Navigate to="/reports" replace />;
  return <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/book" element={<BookingPublic />} />
      <Route path="/track/:token" element={<TrackingPublic />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />

          <Route element={<ProtectedRoute roles={["MANAGER", "RECEPTIONIST", "CASHIER", "TECHNICIAN"]} />}>
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
          </Route>

          <Route element={<ProtectedRoute roles={["MANAGER", "RECEPTIONIST"]} />}>
            <Route path="/appointments" element={<Appointments />} />
          </Route>

          <Route element={<ProtectedRoute roles={["MANAGER", "RECEPTIONIST", "TECHNICIAN"]} />}>
            <Route path="/queue" element={<QueueBoard />} />
          </Route>

          <Route element={<ProtectedRoute roles={["MANAGER", "TECHNICIAN"]} />}>
            <Route path="/maintenance" element={<Maintenance />} />
          </Route>

          {/* ADMIN's only actions here are refund (Billing) / PO-approve (Inventory) --
              create/adjust/operate buttons are hidden for ADMIN inside these pages. */}
          <Route element={<ProtectedRoute roles={["MANAGER", "CASHIER", "ADMIN"]} />}>
            <Route path="/billing" element={<Billing />} />
            <Route path="/billing/invoices/:id" element={<InvoiceDetail />} />
          </Route>

          <Route element={<ProtectedRoute roles={["MANAGER", "ADMIN"]} />}>
            <Route path="/reports" element={<Reports />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/ai" element={<AIInsights />} />
          </Route>

          <Route element={<ProtectedRoute roles={["ADMIN"]} />}>
            <Route path="/users" element={<Users />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
