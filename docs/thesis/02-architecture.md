# 2. System Architecture & Technology Stack

## 2.1 High-level architecture

```
                         ┌────────────────────────────┐
                         │        Customer's          │
                         │   browser / phone (no auth)│
                         └──────────────┬─────────────┘
                                        │ HTTPS
                                        ▼
┌───────────────────────────────────────────────────────────────────┐
│  apps/web  — React 18 SPA (Vite, React Router, React Query)       │
│  Pages: BookingPublic, TrackingPublic, Login, Dashboard,          │
│  QueueBoard, Appointments, Customers, Billing, Maintenance,       │
│  Inventory, Reports, AIInsights, Users                            │
│  Socket.IO client (lib/socket.ts)                                 │
└───────────────────────────┬─────────────────────────┬─────────────┘
              REST (fetch, JWT bearer)        WebSocket (rooms)
                            ▼                         ▼
┌───────────────────────────────────────────────────────────────────┐
│  apps/server — Express app (app.ts)                                │
│  helmet, cors, express.json, static /uploads                      │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Routes (src/routes/*.ts) → Services (src/services/*.ts)      │  │
│  │ auth, customers, vehicles, appointments, queue, maintenance, │  │
│  │ tracking, billing, notifications, reports, inventory, ai,    │  │
│  │ catalog, bays, users                                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌───────────────┐ ┌────────────────┐ ┌──────────────────────┐    │
│  │ lib/auth.ts    │ │ lib/socket.ts  │ │ lib/prisma.ts (ORM)  │    │
│  │ middleware/auth│ │ Socket.IO srv  │ │                      │    │
│  └───────────────┘ └────────────────┘ └──────────┬───────────┘    │
│  ┌───────────────┐ ┌────────────────┐            │                │
│  │ jobs/cron.ts   │ │ ai/ollamaClient│            │                │
│  │ (node-cron)    │ │ (LLM, optional)│            │                │
│  └───────────────┘ └────────────────┘            │                │
└────────────────────────────────────────────────────┼────────────────┘
                                                      ▼
                                          ┌─────────────────────┐
                                          │  SQLite (dev.db)     │
                                          │  via Prisma ORM       │
                                          │  (Postgres-portable)  │
                                          └─────────────────────┘
        external/optional:  SMTP (Nodemailer) · Ollama LLM server (localhost:11434)
```

## 2.2 Architectural style

- **Layered backend:** `routes/` (HTTP concerns, validation, auth/role guards) →
  `services/` (business logic, transactions) → `lib/prisma.ts` (data access). Routes never
  touch Prisma directly for non-trivial operations — they call a service function.
- **Server-rendered state, client-driven UI:** the SPA holds no business logic beyond
  optimistic UI; all authoritative state lives server-side in SQLite, fetched through
  React Query and kept fresh via Socket.IO push events rather than polling.
- **Convergence pattern for the queue:** both the booking flow and the walk-in flow funnel
  into one `QueueEntry` table once a vehicle is physically present, ordered by
  `priority desc, checkedInAt asc` — this avoids maintaining two parallel capacity models
  for "booked" vs "unbooked" vehicles (`services/queue.service.ts`).
- **Adapter pattern for payments:** `services/payments/PaymentProvider.ts` defines a
  `charge()` interface; `mockProvider.ts` implements it with simulated latency/decline
  rates for MoMo, Airtel, card and cash. Swapping in a real payment gateway later means
  writing one new file, not touching `billing.service.ts`.
- **Graceful AI degradation:** the LLM integration (`ai/ollamaClient.ts`) never throws —
  if Ollama isn't running, the chatbot/insights endpoints return a fallback notice instead
  of failing the request. The churn/maintenance scoring path is fully independent of the
  LLM (it's a separate, always-available hand-written model).

## 2.3 Technology stack

### Backend (`apps/server`)

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript (ESM, `"type": "module"`) | ^5.6.3 |
| Runtime | Node.js (via `tsx` for dev) | tsx ^4.19.2 |
| Web framework | Express | ^4.21.1 |
| ORM | Prisma Client | ^5.22.0 |
| Database | SQLite (dev), Postgres-portable | — |
| Real-time | Socket.IO | ^4.8.1 |
| Auth | jsonwebtoken (JWT) + bcryptjs (password hashing) + otplib (TOTP/MFA) | 9.0.2 / 2.4.3 / 12.0.1 |
| Validation | Zod | ^3.23.8 |
| Email | Nodemailer (+ Ethereal fallback in dev) | ^6.9.16 |
| File uploads | Multer | ^1.4.5-lts.1 |
| Reporting exports | ExcelJS, PDFKit | 4.4.0 / 0.15.1 |
| QR codes | qrcode | ^1.5.4 |
| Scheduling | node-cron | ^3.0.3 |
| Logging | Pino + pino-http (+ pino-pretty in dev) | ^9.5.0 |
| Security headers | Helmet | ^7.1.0 |
| Testing | Vitest | ^2.1.4 |

### Frontend (`apps/web`)

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | ^5.6.3 |
| UI library | React | ^18.3.1 |
| Build tool | Vite | ^5.4.10 |
| Routing | React Router DOM | ^6.28.0 |
| Server-state/cache | TanStack React Query | ^5.59.16 |
| Forms | React Hook Form | ^7.53.2 |
| Styling | Tailwind CSS (+ PostCSS, Autoprefixer) | ^3.4.14 |
| Charts | Recharts | ^2.13.3 |
| Icons | lucide-react | ^0.460.0 |
| Real-time client | socket.io-client | ^4.8.1 |
| Dates | date-fns | ^4.1.0 |
| Validation | Zod | ^3.23.8 |

### AI/local LLM (optional runtime dependency)

- Served via [Ollama](https://ollama.ai) on `OLLAMA_BASE_URL` (default `http://localhost:11434`), model name from `OLLAMA_MODEL` (default `ikinamba-ai`). Used only for the chatbot and the dashboard narrative — see [06-ai-ml-module.md](06-ai-ml-module.md).
- Churn-risk and maintenance-due scoring use a **hand-written logistic regression**
  (`apps/server/src/ai/logisticRegression.ts`) with no external ML library dependency.

## 2.4 Deployment / runtime topology

- **Monorepo**, npm workspaces (`apps/server`, `apps/web`), root `package.json` orchestrates both via `concurrently` for local dev (`npm run dev`).
- Server listens on `PORT` (default 4000); web dev server (Vite) on 5173, proxying/CORS-allowed via `CLIENT_ORIGIN`.
- Static uploads served from `apps/server/uploads` at `/uploads/*`.
- SQLite file (`DATABASE_URL`, e.g. `file:./dev.db`) — single-file database, trivially backed up (see `jobs/backup.ts`).
- No containerization/orchestration layer is present in the repo (no Dockerfile) — deployment today is direct Node.js process + static SPA build, suitable framing for a single-shop deployment described in the proposal's scope.

## 2.5 Security & access control design

- **Authentication:** email + password login (`auth.routes.ts` → `lib/auth.ts`); passwords hashed with bcryptjs (10 rounds); successful login issues a JWT (`JWT_SECRET`, default expiry `8h`) carrying `{ sub: userId, role, customerId? }`.
- **MFA:** staff accounts can enroll TOTP (otplib) — `/auth/mfa/setup` returns a secret + otpauth URI for an authenticator app QR code; `/auth/mfa/verify` confirms enrollment. Once enabled, login requires the 6-digit code (frontend handles the `TOTP_REQUIRED` response by prompting for it).
- **Authorization:** `middleware/auth.ts` exposes `authenticate()` (verifies the bearer JWT) and `requireRole(...roles)` (403s if the caller's role isn't in the allowed set); every protected route declares its allowed roles explicitly (see [05-api-reference.md](05-api-reference.md) for the full matrix).
- **Customer self-service without an account:** booking and tracking are deliberately unauthenticated (a tracking token is the capability, not a login) — this matches the requirement for 24/7 walk-up booking without forcing account creation.
- **Audit trail:** `lib/audit.ts` writes an `AuditLog` row (`action`, `entity`, `entityId`, `metadata`, `userId`) on state-changing operations (logins, payments, user deactivation, QC sign-off, etc.), viewable by ADMIN via `/users/audit-log`.
- **Backups:** `jobs/backup.ts` snapshots the SQLite file nightly (02:00) with 14-day retention, and can be triggered manually by ADMIN via `/users/backup` — directly answering the AS-IS finding that the paper ledger had no backup/recovery story.
