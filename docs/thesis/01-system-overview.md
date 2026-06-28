# 1. System Overview

## 1.1 What IKINAMBA is

IKINAMBA is a web-based platform that digitizes vehicle service and car wash operations
for New Class Car Wash. It replaces the paper-ledger/walk-in workflow with a single
system spanning customer intake, appointment booking, live queue/bay management, vehicle
maintenance records, billing/loyalty, notifications, reporting, inventory, and role-based
access control — plus a small AI subsystem for churn/maintenance prediction and a local
LLM-backed chatbot and insights narrative.

It ships as two cooperating applications in one repository:

- **`apps/server`** — a TypeScript/Express REST + Socket.IO API, backed by SQLite via Prisma ORM.
- **`apps/web`** — a TypeScript/React single-page application (Vite, React Router, React Query, Tailwind).

## 1.2 Objectives → implementation mapping

This table is the evidence base for "Expected Results were achieved" in Chapter 1/5. Each
specific objective from the approved proposal is mapped to the concrete code that
realizes it.

| Specific objective (from proposal) | Realized by |
|---|---|
| Develop a system for managing vehicle service and car wash operations | Full-stack app: `apps/server`, `apps/web` |
| Integrate vehicle maintenance, inspection, and service tracking functionalities | `maintenance.routes.ts` + `MaintenanceInspection` model; `tracking.routes.ts` + Socket.IO live updates |
| Improve customer experience through digital service management | Public booking (`BookingPublic.tsx`), public tracking page with QR code (`TrackingPublic.tsx`, `/track/:token/qrcode.png`), chatbot (`ai/chatbot.ts`) |
| Enable real-time monitoring of service progress and appointments | Socket.IO rooms `queueBoard` and `tracking:{token}` (`lib/socket.ts`); `QueueBoard.tsx` |
| Enhance operational efficiency and workflow coordination | Unified `QueueEntry` model converges appointments and walk-ins into one priority-ordered queue (`services/queue.service.ts`) |
| Provide analytics and reporting for automotive service management | `reports.service.ts` (revenue, popularity, peak hours, staff productivity, retention) + Excel/PDF export |

## 1.3 The 10 functional modules (proposal → code)

The approved proposal specifies 10 modules. All 10 are implemented; this is the
one-to-one mapping to use in Chapter 2 "Proposed Solutions" / Chapter 4 "Presentation of
the New System."

| # | Module (proposal) | Backend | Frontend |
|---|---|---|---|
| 1 | Customer & Vehicle Management | `customers.routes.ts`, `vehicles.routes.ts` | `Customers.tsx`, `CustomerDetail.tsx` |
| 2 | Service Booking & Appointment | `appointments.routes.ts`, `services/appointments.service.ts` | `BookingPublic.tsx`, `Appointments.tsx` |
| 3 | Car Wash Queue & Bay Management | `queue.routes.ts`, `bays.routes.ts`, `services/queue.service.ts` | `QueueBoard.tsx` |
| 4 | Vehicle Maintenance | `maintenance.routes.ts` | `Maintenance.tsx` |
| 5 | Real-Time Service Tracking | `tracking.routes.ts`, `lib/socket.ts` | `TrackingPublic.tsx` |
| 6 | Payment & Billing | `billing.routes.ts`, `services/billing.service.ts`, `services/payments/*` | `Billing.tsx`, `InvoiceDetail.tsx` |
| 7 | Notification & Communication | `notifications.routes.ts`, `services/notifications.service.ts`, `lib/mailer.ts` | `ChatWidget.tsx`, notification surfaces in `CustomerDetail.tsx` |
| 8 | Reporting & Analytics | `reports.routes.ts`, `services/reports.service.ts` | `Reports.tsx` |
| 9 | Inventory & Resource Management | `inventory.routes.ts` | `Inventory.tsx` |
| 10 | Security & Access Control | `lib/auth.ts`, `middleware/auth.ts`, `users.routes.ts`, `lib/audit.ts` | `Login.tsx`, `Users.tsx`, `AuthContext.tsx` |

A small extra, beyond the original 10 modules, was added during build: an **AI/Analytics
subsystem** (churn risk, maintenance-due scoring, LLM chatbot, LLM dashboard narrative —
see [06-ai-ml-module.md](06-ai-ml-module.md)). Frame this in Chapter 4 as a value-add
under Reporting & Analytics / Customer Management rather than an 11th module, since it
extends modules 1 and 8 rather than standing alone.

## 1.4 Roles (actors)

Each role has its own distinct scope rather than a seniority hierarchy — ADMIN does not
automatically get MANAGER's operational tools, and MANAGER does not automatically get
CASHIER/RECEPTIONIST/TECHNICIAN's day-to-day work. Cross-role access exists only where
there's a genuine workflow reason (e.g. ADMIN signing off a refund or PO is a
financial-control check, not borrowed seniority).

| Role | Typical user | Scope |
|---|---|---|
| ADMIN | Owner/IT admin | System administration (user management, audit log, manual backup); financial-control sign-off only (invoice refunds, purchase-order approval); business-oversight visibility (Reports & analytics, AI insights — view-only) |
| MANAGER | Shop manager | Runs day-to-day operations: appointments, queue & bays, customers, billing (invoice/payment), inventory (items/suppliers/POs/receiving), catalog pricing, notifications, reports & AI insights (incl. recompute) |
| CASHIER | Front-desk cashier | Customers, billing/invoices (create, record payment) |
| RECEPTIONIST | Front-desk staff | Appointments, customers, queue board, walk-in check-in, notification log |
| TECHNICIAN | Wash/service technician | Queue board, maintenance inspections, QC sign-off |
| CUSTOMER | Walk-in/online customer | Public booking, public tracking, own chat messages — no login required for the core flow |

## 1.5 Glossary / abbreviations

| Term | Meaning |
|---|---|
| Bay | A physical wash/service stall a vehicle occupies while being worked on |
| QueueEntry | A vehicle physically present and needing/holding a bay slot; created from a checked-in appointment or a walk-in |
| ServiceJob | The work order attached 1:1 to a QueueEntry once it reaches a bay; holds line items, technician, QC sign-off |
| QC | Quality Check — mandatory sign-off step before a job can be marked READY |
| Tracking token | Random 24-hex-char token issued per QueueEntry; lets a customer view live status without logging in |
| Loyalty tier | BRONZE / SILVER / GOLD, derived from lifetime spend; affects queue priority and points |
| LLM | Large Language Model — here, a small model served locally via Ollama, used for the chatbot and dashboard narrative (not for churn/maintenance scoring, which uses a hand-written logistic regression model) |
| MoMo | Mobile Money (MTN), one of the simulated payment methods |
| TOTP | Time-based One-Time Password — the MFA mechanism for staff accounts |
| JWT | JSON Web Token — the bearer-token format used for session auth |
