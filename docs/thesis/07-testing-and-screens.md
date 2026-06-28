# 7. Testing Strategy & "Presentation of the New System"

## 7.1 Honest status of automated testing

Be accurate in the thesis rather than overclaiming: `apps/server/package.json` has
Vitest (^2.1.4) configured (`"test": "vitest run"`) and `apps/web` has the TypeScript
compiler wired for `tsc --noEmit`, but **no `*.test.ts` files exist in the repo yet** —
there is no committed automated test suite at the time of writing. If your testing
chapter needs to describe what *was* done, frame it around the three things that are
real:

1. **Type-checking as a correctness gate** — both workspaces pass `tsc --noEmit` with zero
   errors, which catches an entire class of integration bugs (mismatched API shapes
   between client/server, wrong Prisma field names, etc.) before runtime.
2. **Seeded-data manual/system testing** — `apps/server/prisma/seed.ts` generates a
   reproducible synthetic dataset (staff users, bays, a service catalog, and a cohort of
   customers with multi-visit history spread over time) specifically so the full
   application — including the AI training pipeline, which needs historical data to
   produce a meaningful model — can be exercised end-to-end without needing real
   production data.
3. **Manual UAT walkthroughs** — the realistic path for this thesis is to document a
   manual User Acceptance Test: pick 1–2 representative end-to-end scenarios (e.g. "online
   booking → check-in → wash → QC → invoice → payment", "low-stock item → purchase order →
   receive") and record actual screenshots + pass/fail observations. Section 7.3 below
   gives you a checklist.

If you want this documentation pack to *also* cover an automated suite, that's a
follow-up implementation task (writing actual `*.test.ts` files with Vitest), not
something to describe as already done.

## 7.2 What would constitute each testing level (for the Chapter 4 subsections)

| Level | What it means here | Status |
|---|---|---|
| Unit Testing | Vitest tests for isolated logic — e.g. `lib/loyalty.ts` tier thresholds, `ai/logisticRegression.ts` sigmoid/standardize math, `services/appointments.service.ts` slot-capacity calculation | Framework present, not yet written |
| Integration Testing | Exercising a route → service → Prisma chain against a real (test) SQLite DB — e.g. POST `/appointments` then GET `/appointments/availability` reflects the new booking | Framework present, not yet written |
| Validation/UAT Testing | Manual run-through of each module's primary flow by a person playing each role, against the seeded dataset | Performed manually during development; document your own session per the checklist below |
| Performance Testing | None automated; informal — Ollama calls have a 180s timeout specifically because local CPU inference is slow, which is a known, documented limitation rather than an untested unknown | Not formally measured |

## 7.3 UAT checklist (fill in with your own screenshots/results)

For each row: perform the action against the running app (seeded login `Passw0rd!` per
`Login.tsx`), capture a screenshot, and note pass/fail + any defect found.

- [ ] Public booking: select services → pick an available slot → submit → confirmation shown
- [ ] Booking widget correctly blocks a slot once bay capacity is full
- [ ] Receptionist checks in a confirmed appointment → entry appears on Queue Board
- [ ] Receptionist adds a walk-in directly to the queue
- [ ] Technician assigns next vehicle to a free bay → status flips to IN_SERVICE, customer's tracking page updates live (open both screens side-by-side)
- [ ] Technician records a maintenance inspection with photo upload
- [ ] Attempting to mark a job READY without QC sign-off is blocked
- [ ] Technician/Manager signs QC → bay frees up, customer notified, tracking page shows READY
- [ ] Cashier generates an invoice from a completed job, applies a loyalty-point redemption
- [ ] Cashier records a split payment (two payment methods on one invoice)
- [ ] Manager refunds a paid invoice
- [ ] Manager views the Reports page and exports both Excel and PDF
- [ ] Manager triggers AI insight recompute and sees churn-risk labels on the Customers page
- [ ] Customer uses the chatbot widget and gets a catalog-grounded answer (and a graceful message if Ollama isn't running)
- [ ] Admin creates a new staff user, enrolls MFA, and logs in with a TOTP code
- [ ] Admin deactivates a user and confirms they can no longer log in
- [ ] Admin views the audit log and finds entries for the actions above
- [ ] Manager creates → approves → receives a purchase order and confirms stock increments

## 7.4 "Presentation of the New System" — screenshot slots by module

Use this as your shot list; each bullet is one figure to capture from the running app and
insert into Chapter 4. Page files are in `apps/web/src/pages/`.

| Figure | Page | What to show |
|---|---|---|
| Login | `Login.tsx` | Email/password form, TOTP field shown after MFA challenge |
| Customer & Vehicle Management | `Customers.tsx`, `CustomerDetail.tsx` | Search results with loyalty tier badges; detail view with vehicles/invoices/loyalty history/AI insight |
| Booking (public) | `BookingPublic.tsx` | Service selection, date/time slot picker, confirmation screen |
| Appointments (staff) | `Appointments.tsx` | Day's appointment list with check-in/cancel/reschedule actions |
| Queue Board | `QueueBoard.tsx` | Bay grid with active jobs, waiting list, assign/QC/complete controls |
| Live Tracking (public) | `TrackingPublic.tsx` | 5-stage progress indicator, QR code |
| Vehicle Maintenance | `Maintenance.tsx` | Inspection checklist form, photo upload, history view |
| Billing | `Billing.tsx`, `InvoiceDetail.tsx` | Billable list, invoice detail with split payments and refund |
| Inventory | `Inventory.tsx` | Stock list with low-stock highlighting, PO draft→approve→receive |
| Reports | `Reports.tsx` | Revenue chart, service popularity, staff productivity, export buttons |
| AI Insights | `AIInsights.tsx` | Ollama status indicator, narrative summary, churn-risk table |
| User Management | `Users.tsx` | Staff list with roles/TOTP status, audit log, manual backup |
| Chat widget | `ChatWidget.tsx` (overlay on booking/tracking) | Customer chatting with the grounded chatbot |

## 7.5 Hardware/software compatibility notes (for "Client Side Software Requirements")

- **Server runtime:** Node.js ≥ 18 (ESM, `"type": "module"` in `package.json`); any OS that runs Node.
- **Database:** SQLite file, zero external DB server required for the demo/thesis defense; swappable to PostgreSQL for production by changing `schema.prisma`'s `provider` and `DATABASE_URL`.
- **Client:** any modern evergreen browser (Chrome/Edge/Firefox) — the frontend is a standard React SPA with no browser-specific APIs beyond `localStorage` and WebSocket.
- **Optional:** a local Ollama installation if you want to demo the chatbot/insights narrative live; the rest of the system (including churn/maintenance ML scoring) works without it.
- **Network:** LAN/offline-capable for the core workflow (booking, queue, billing) once deployed on-prem; only email delivery (SMTP) and the optional LLM need external/local services respectively.
