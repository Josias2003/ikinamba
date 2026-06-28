# 8. Full Functional Test Script (click-by-click, zero prior knowledge assumed)

This script is written for someone who has never seen this project before -- every
section explains what the screen *is* before saying what to click. Companion to
[07-testing-and-screens.md](07-testing-and-screens.md) (action-level UAT checklist +
screenshot shot list) and [01-system-overview.md §1.4](01-system-overview.md) (the formal
per-role permission matrix this maps to).

## What this system is

**New Class Car Wash** (internal codename **IKINAMBA**) is a management system for a
vehicle service & car wash business. A customer can book online or walk in; a staff
member checks their vehicle into a "queue" against a physical bay; a technician services
it; a cashier invoices and takes payment; the customer tracks progress live on their
phone via a QR code; and the business gets reports, AI-driven churn-risk/demand
forecasting, and inventory/purchase-order management on the back end.

The system enforces **real per-role separation**: every action belongs to exactly one
job, not a seniority hierarchy. ADMIN does not inherit MANAGER's day-to-day powers, and
MANAGER does not inherit CASHIER's/RECEPTIONIST's/TECHNICIAN's either. Each role table
below explains *why* a given role can or can't do something -- this is deliberate design,
not a missing feature.

## Before you start

- Fresh seeded data: `cd apps/server && npm run db:seed`. This wipes and rebuilds the
  database with a large, realistic dataset: **2,500 customers**, ~3,250 vehicles, **over
  13,000 completed visits** (invoices/payments/loyalty history) spread across the last 12
  months, ~6,600 maintenance inspections, 3,000 notification-log entries, and 500 audit
  log entries -- well over 100,000 rows total. This is what makes the AI churn-risk model,
  demand forecast, and the paginated lists below meaningful instead of toy data.
  - The seed script trains the churn-risk and predictive-maintenance models, then computes
    an insight for every one of the 2,500 customers -- this last step alone takes a couple
    of minutes. The terminal will print progress; let it finish before logging in if you
    want AI Insights to show real numbers immediately.
  - Customer behavior is intentionally varied (loyal/occasional/churned/new patterns), so
    AI Insights' churn table will reliably show a real mix of LOW/MEDIUM/HIGH risk every
    run, not a hand-picked example.
  - All 6 staff logins, 6 bays, and the 12-item service catalog are fixed every run.
- **Not pre-seeded** — these start empty/zero and only populate once you act during the
  demo: the Queue Board, Billing's "Ready to invoice" list, and the purchase-order list.
- **Because the dataset is large, several lists are now paginated and searchable**:
  Customers, the Billing invoice list, and the audit log on the Users page. Use the
  search box to find a specific record instead of scrolling, and the Prev/Next controls
  at the bottom of the table to page through the rest.
- **Known UI gaps** (backend route exists, no frontend control yet -- don't promise these
  live without building the UI first): creating a **supplier**, creating a **purchase
  order** (only approve/receive of an existing one has buttons), and **redeeming loyalty
  points** on an invoice. The notification broadcast feature also has no dedicated page --
  it's reachable only via the API.

## Role → page access map

MANAGER's column is narrower than it used to be: appointments, invoicing/payments, floor
dispatch (walk-in/bay-assign/technician-assign/complete), and QC sign-off are each a
*named* responsibility of one specific front-line role, so MANAGER no longer duplicates
them. MANAGER's own exclusive ground is inventory operations, catalog pricing, bay setup,
AI recompute, and notification broadcast -- plus the same oversight views (Reports/AI/
Billing-invoice-list/Inventory-PO-list) ADMIN has, since *viewing* isn't "doing" the
underlying action.

| Page | ADMIN | MANAGER | CASHIER | RECEPTIONIST | TECHNICIAN |
|---|---|---|---|---|---|
| Live floor (`/`) | — | view-only | — | ✓ | ✓ |
| Queue & bays (`/queue`) | — | view-only | — | ✓ | ✓ (QC sign-off only) |
| Appointments (`/appointments`) | — | view-only | — | ✓ | — |
| Maintenance (`/maintenance`) | — | ✓ | — | — | ✓ |
| Customers (`/customers`) | — | ✓ | ✓ | ✓ | ✓ |
| Billing (`/billing`) | refund-only | view-only | ✓ | — | — |
| Inventory (`/inventory`) | approve-only | items/suppliers/receiving | — | — | — |
| Reports (`/reports`) | view-only | view-only | — | — | — |
| AI Insights (`/ai`) | view-only | full (incl. recompute) | — | — | — |
| Users (`/users`) | ✓ | — | — | — | — |
| My Report (`/my-report`) | — | — | ✓ | ✓ | ✓ |
| Profile (`/profile`) | ✓ | ✓ | ✓ | ✓ | ✓ |

"View-only" means the page is reachable and shows real data, but every create/adjust/
operate button on it is hidden for that role (mirrors how ADMIN's Billing/Inventory access
already worked) -- the backend blocks the same actions server-side too, so this isn't just
a UI nicety.

---

## Public, no login

### Landing page — `/`
1. Open the app logged out. You land on the public Landing page (business name/case
   study, service list pulled live from the catalog, two CTAs).
2. Click **Book a service** → goes to `/book`.
3. Use the **Track my vehicle** box: paste any tracking code → goes to `/track/:code`.
4. Click **Staff login** (top-right) → goes to `/login`.

### Book a service — `/book`
1. Tick 1+ services (live catalog, real prices/durations).
2. Pick a date, then a time slot (greyed out = full).
3. Fill name/phone/vehicle make/model/plate/year.
4. Click **Confirm booking** → confirmation screen with a real tracking QR + link.
5. Click **Book another** to reset and repeat.

### Track a vehicle — `/track/:token`
1. Open the tracking link/QR from a booking or a staff check-in.
2. See the 5-stage progress indicator (Checked in → In service → Quality check → Ready →
   Completed) and current bay/services.
3. Leave the tab open while a staff member advances the job elsewhere (see Queue & Bays
   below) — the page updates live with no refresh (Socket.IO).

### Chatbot widget — bottom-right on any public page
1. Click **Ask AI**.
2. FAQ test: ask "what services do you offer" or "how much is a premium wash" — answers
   are grounded in the real catalog (it won't invent a price).
3. Voice-booking test: click the mic icon (Chrome/Edge only) or type "hi, can you book me
   a wash tomorrow at 9am" with nothing else filled in.
   - It asks for whatever's missing (name, phone, vehicle, service) one piece at a time.
   - Once it has everything, it shows a **preview** ("Shall I book it?") — nothing is
     booked yet at this point, confirmed by no tracking QR appearing.
   - Reply "yes" → it books for real and a tracking QR renders directly in the chat.
4. If logged in as MANAGER/ADMIN, ask "show me a chart of our revenue" — a real bar chart
   renders inline. Logged in as RECEPTIONIST, the same question is politely refused (role
   gate holds even inside the chatbot).

---

## Login, first-time password change & Profile — every role

### Logging in for the first time with a temp password
This is the normal lifecycle for any account ADMIN creates (see the Users section below):
ADMIN sets a one-time temp password → the new user logs in with it → they are immediately
blocked from everything else until they pick their own password.
1. Log in with the temp email/password ADMIN gave you.
2. You land on **Set a new password**, not your normal home page -- every other page is
   unreachable (typing a URL directly redirects back here too).
3. Enter the temp password again as "current", then a new password (8+ characters) twice.
4. Click **Change password** → you land on your normal home page, and this screen never
   appears again for this account.

The 6 seeded staff accounts (table at the bottom) skip this -- they're defense-day
credentials, not first-time temp passwords, so they go straight to the normal login flow
below.

### Logging in — `/login`
1. Enter one of the 6 staff emails (see credentials below) + `Passw0rd!`.
2. Click **Log in** → lands on that role's home page.

### Profile — `/profile` (every role)
Click your email/role chip top-right in the header to get here.
1. **Edit your name/phone**: change either field under "Profile information", click
   **Save**.
2. **Change your password voluntarily** (not just on first login): under "Change
   password", enter your current password, then a new one twice, click **Change
   password**. Same backend action as the forced first-login screen, just reachable
   anytime.
3. **Enable 2FA**: click **Enable 2FA**, scan the QR with an authenticator app (or copy
   the raw secret text shown below it), enter the 6-digit code, click **Confirm**. Status
   flips to "Enabled". Log out and back in with the same password — now prompted for an
   authentication code.
4. **Disable 2FA**: click **Disable 2FA**, enter the current 6-digit code, confirm. Status
   flips back to "Disabled"; logging in again no longer prompts for a code.
5. **Notification preference**: toggle "Receive system notification emails" off/on.

---

## Live floor — `/` (RECEPTIONIST, TECHNICIAN full; MANAGER view-only)

Read-only dashboard: bay tiles with live elapsed-time timers, the waiting list, and a
"quick access" grid linking to every other page that role can reach. Nothing to click
beyond navigation. (ADMIN is redirected to `/reports` instead, since it has no floor
access at all.)

## Queue & bays — `/queue` (RECEPTIONIST full; TECHNICIAN: QC sign-off only; MANAGER view-only)

1. **Walk-in check-in** (RECEPTIONIST only): in the "Walk-in check-in" card, search an
   existing vehicle by plate (must already be registered — use one from Customers), click
   the result's **Check in** button. A QR modal pops up.
2. **Assign to a bay** (RECEPTIONIST only): on an idle bay card, click **Assign next
   waiting vehicle**.
3. **Add a service item** (any of the three floor roles): on an occupied bay, click **Add
   service**, tick items, click **Add**.
4. **Assign a technician** (RECEPTIONIST only — a floor-dispatch decision, not something a
   technician can do for themself): use the "Assign technician..." dropdown on the bay
   card.
5. **Move to QC** (any of the three floor roles): once status is "In service", click
   **Move to QC**.
6. **Sign QC & release** (TECHNICIAN only): click the button — bay frees up, customer's
   tracking page flips to "Ready for pickup" live. (RECEPTIONIST and MANAGER see "Awaiting
   technician sign-off" instead of the button — separation-of-duties control: only the
   technician who can vouch for the work signs off on it.)
7. **Mark picked up** (RECEPTIONIST only): once status is "Ready", click **Mark picked
   up** — or click **Scan to pick up** (top-right) and scan the customer's tracking QR
   with the camera instead.
8. Click **Show QR** on any entry to re-display its tracking QR/link.
9. As MANAGER: open `/queue` — every tile/list is visible for oversight, but none of the
   buttons above appear; the page is read-only.

## Appointments — `/appointments` (RECEPTIONIST full; MANAGER view-only)

1. Use the search box to filter by customer name or plate; change the date picker to
   browse other days; click the **Time**/**Customer**/**Status** column headers to sort.
2. On a `CONFIRMED` row, click **Check in** (RECEPTIONIST only) → creates a live queue
   entry + QR modal (now visible on the Queue Board).
3. Click **Cancel** (RECEPTIONIST only) on a row to cancel it instead.
4. As MANAGER: open `/appointments` — the full day's bookings are visible for oversight,
   but no Check in/Cancel buttons appear.

## Maintenance & inspections — `/maintenance` (MANAGER, TECHNICIAN)

1. Search a vehicle by plate.
2. Click a result to open its inspection history.
3. Click **New inspection**: tick checklist items (OK/Attention/Failed), enter DTC codes
   comma-separated (e.g. a vehicle with `P0420` on file already exists in seeded data —
   search for one to see this rendered), mileage, findings, optionally attach photos.
4. Click **Save inspection** → appears immediately in the history list below.

## Customers & vehicles — `/customers` (MANAGER, RECEPTIONIST, CASHIER, TECHNICIAN)

This list now holds 2,500 real customers, so it's paginated and server-searched (not just
filtering what's already on screen).
1. Type into the search box (name, phone, or plate) — results come from the full dataset,
   not just the current page.
2. Click **Name** or **Loyalty** column headers to sort (server-side, applies across all
   2,500 customers, not just the visible page).
3. Use **Prev**/**Next** at the bottom of the table to page through results.
4. Click **New customer**, fill name/phone/email/address, **Save**.
5. Click a customer name → detail page: loyalty tier/points, AI churn-risk +
   maintenance-due score (computed for every seeded customer), vehicle list, invoice
   history.
6. Click **Add vehicle**, fill make/model/year/plate, **Add**.

## Billing & invoices — `/billing` (CASHIER full; MANAGER view-only; ADMIN refund-only)

The invoice list is paginated (13,000+ rows in the seeded data) and server-sorted on
Date/Total/Status.
1. **Generate an invoice** (CASHIER only — hidden for MANAGER and ADMIN): in "Ready to
   invoice" (populated once a job is completed via the Queue Board), click **Generate
   invoice**.
2. Use the search box (customer name) and column-header sort on the invoice table; page
   through with Prev/Next.
3. Click an invoice row → detail page.
4. **Record a payment** (CASHIER only): pick a method, enter an amount, click **Pay** —
   call it twice with two different methods on the same invoice to demonstrate split
   payment.
5. **Refund** (ADMIN only): once status is `PAID`, click **Refund**.
6. Click **Print receipt** for the print-friendly view.
7. As MANAGER: open `/billing` — the full invoice list is visible and searchable for
   oversight, but "Ready to invoice" and the Pay form are absent, and there's no Refund
   button either.
8. As ADMIN: open `/billing` — a caption explains the list is narrowed to paid invoices
   only (refund is the only action available); the "Ready to invoice" panel and Pay form
   are absent; only **Refund** is clickable.

## Inventory & purchase orders — `/inventory` (MANAGER: items/suppliers/receiving; ADMIN: approve-only)

1. As MANAGER: search/sort the items table (low-stock rows highlighted red — Oil
   Filters/Car Shampoo by default). Click **Adjust** on a row to open the stock-adjustment
   modal (add or remove, with a reason). Click **New item** for a new inventory item.
2. On an `APPROVED` purchase order, click **Receive** (stock increments automatically) —
   MANAGER cannot approve a draft PO itself, only receive an already-approved one.
3. As ADMIN: open `/inventory` — a caption explains the list is narrowed to draft purchase
   orders only; only **Approve** is clickable on a `DRAFT` row, nothing else is visible.

## Reports — `/reports` (MANAGER, ADMIN — both view-only)

1. Use the date-range picker (This week / This month / This quarter / custom) at the top.
2. View the revenue line chart, service-popularity and peak-hours bar charts, staff
   productivity table, and retention metric cards for that range.
3. Click **Excel** / **PDF** to download exports for the selected range.

## My Report — `/my-report` (CASHIER, RECEPTIONIST, TECHNICIAN)

Each of these three roles gets its own activity report instead of the full business
dashboard above (which is MANAGER/ADMIN's job to read) — invoices/collections for
CASHIER, check-ins for RECEPTIONIST, jobs/QC sign-offs for TECHNICIAN.
1. Use the date-range picker the same way as Reports.
2. Click **Excel** / **PDF** to export.

## AI Insights — `/ai` (MANAGER full; ADMIN view-only)

1. View the local-LLM-generated manager narrative, the 7-day demand forecast chart, and
   the churn/maintenance-due table across all 2,500 seeded customers.
2. Click **Regenerate narrative** (both roles) to re-run the LLM summary.
3. Click **Recompute scores** (MANAGER only — hidden for ADMIN) to re-run the churn/
   maintenance model against current data. At this dataset size, expect this to take a
   couple of minutes — same per-customer computation the seed script runs once already.

## Users & audit log — `/users` (ADMIN only)

1. Click **New user**, fill email/temp password/role, **Create**. That account's first
   login will be intercepted by the forced password-change screen (see the walkthrough
   above) -- this is the normal account-provisioning flow, not a special case.
2. Search by email or filter by role on the users table.
3. Click **Deactivate** on an active user — their `isActive` flips false (try logging in
   as them afterward to confirm login is now blocked).
4. The audit log below is now paginated and searchable (action/user/entity) with category
   and date-range filters — every action performed during your demo session (check-ins,
   payments, refunds, QC sign-offs, password changes, user changes) appears here.

---

## Credentials (password `Passw0rd!` for all)

| Role | Email |
|---|---|
| ADMIN | `josiaszacharie@gmail.com` |
| MANAGER | `vianew440@gmail.com` |
| CASHIER | `blackhathackers2022@gmail.com` |
| RECEPTIONIST | `bikomeye9@gmail.com` |
| TECHNICIAN | `sindnepom@gmail.com` |
| TECHNICIAN (2nd) | `junique1jay@gmail.com` |

All six are real inboxes you have access to — appointment confirmations, payment
receipts, and other notification emails actually deliver to them via the configured SMTP,
so you can show a real received email during the defense if asked. These six accounts
have no forced password change (they're defense-day credentials, not temp passwords) — to
demonstrate the temp-password flow, create a brand-new user as ADMIN during the demo.
