# IKINAMBA (New Class Car Wash) Manual Testing Guide

This file is for the person who will test the system manually.

## 1. Prerequisites

Install these first:

1. Node.js 20 or later
2. npm 10 or later (comes with Node.js)
3. MySQL Server 8.x
4. MySQL Workbench or another MySQL client
5. A code editor such as VS Code
6. (Optional, for the AI chatbot widget) [Ollama](https://ollama.com/) running locally

## 2. Local Installation

### Step 1: Install Node.js

1. Open https://nodejs.org/
2. Download the LTS version
3. Run the installer
4. Keep the default options
5. Finish the installation
6. Open a new terminal and run:

```powershell
node -v
npm -v
```

### Step 2: Install MySQL

1. Open https://dev.mysql.com/downloads/installer/
2. Download MySQL Installer
3. Choose the `Developer Default` setup if available
4. Install MySQL Server and MySQL Workbench
5. During setup, keep note of:
   - MySQL username (often `root`)
   - MySQL password
   - Port, usually `3306`
6. After installation, open MySQL Workbench and confirm you can connect

### Step 3: Create the database

In MySQL Workbench, run:

```sql
CREATE DATABASE ikinamba CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Step 4: Configure the environment file

Copy [apps/server/.env.example](apps/server/.env.example) to `apps/server/.env` and fill in
your real MySQL credentials:

```env
DATABASE_URL="mysql://YOUR_MYSQL_USER:YOUR_MYSQL_PASSWORD@localhost:3306/ikinamba"
JWT_SECRET="any-long-random-secret"
JWT_EXPIRES_IN="8h"
PORT=4000
CLIENT_ORIGIN="http://localhost:5173"
```

If SMTP values are left blank, core login/booking/check-in still work — only emailed
notifications and 2FA-enrollment QR delivery won't actually send anywhere. Ollama is only
needed for the AI chatbot widget; every other page works without it.

### Step 5: Install project dependencies

From the project root, run:

```powershell
npm install
```

This is an npm workspace — one install at the root covers both `apps/server` and
`apps/web`.

### Step 6: Create tables and seed demo data

Run:

```powershell
npm run db:migrate
npm run db:seed
```

`db:seed` wipes and rebuilds the database with a large, realistic dataset (2,500
customers, ~123,000 rows total), then trains the AI churn-risk/predictive-maintenance
models and computes an insight for every customer. This takes a few minutes — let it
finish before logging in if you want AI Insights to show real numbers immediately.

### Step 7: (Optional) Set up the AI chatbot model

```powershell
ollama pull qwen2.5:1.5b-instruct
ollama create ikinamba-ai -f apps/server/ollama/Modelfile
```

Skip this if you're not testing the chatbot widget — every other feature works without it.

### Step 8: Start the app

```powershell
npm run dev
```

This starts both the backend and frontend together. Open:

`http://localhost:5173`

## 3. Demo Test Accounts

Use password:

`Passw0rd!`

| Role | Email |
|---|---|
| Admin | `josiaszacharie@gmail.com` |
| Manager | `vianew440@gmail.com` |
| Cashier | `blackhathackers2022@gmail.com` |
| Receptionist | `bikomeye9@gmail.com` |
| Technician | `sindnepom@gmail.com` |
| Technician (2nd) | `junique1jay@gmail.com` |

None of these accounts has 2FA enabled by default — 2FA is opt-in, enabled per-account
from the Profile page, not a fixed property of any role. To test the 2FA flow, log in as
any account above and enable it yourself from Profile (see section 6).

These six accounts have **no forced password change** — they're fixed defense-day
credentials, not temporary ones. To see the temp-password flow, create a brand-new user
as Admin (see Flow A, step A8 variant, or section 6).

## 4. Main Process Flow To Test

Test the system in this order so the workflow makes sense.

### Flow A: A Customer Visit, Start to Finish

This is the core flow: a vehicle comes in, gets serviced, and gets paid for, with the
customer able to track progress live the whole time.

#### A1. Book online as the customer (no login required)

1. Open `http://localhost:5173/book`
2. Tick one or more services
3. Pick a date, then a time slot
4. Fill in name, phone, vehicle make/model/plate/year
5. Click `Confirm booking`

Expected result:
A confirmation screen appears with a tracking QR code and link. Keep this tab open —
you'll watch it update live in step A6.

#### A2. Login as Receptionist

1. Open a new tab at `http://localhost:5173/login`
2. Enter:
   - Email: `bikomeye9@gmail.com`
   - Password: `Passw0rd!`
3. Click `Log in`
4. Open `Bookings`

#### A3. Check in the appointment

1. Find today's booking from step A1 (status `CONFIRMED`)
2. Click `Check in`

Expected result:
A QR modal appears, and the booking now shows as a live entry on the Queue Board.

#### A4. Assign the vehicle to a bay

1. Open `Queue & bays`
2. On an idle bay card, click `Assign next waiting vehicle`

Expected result:
The vehicle moves from "Waiting" onto the bay card, with a live elapsed-time timer.

#### A5. Login as Technician and do the work

1. Sign out
2. Login with:
   - Email: `sindnepom@gmail.com`
   - Password: `Passw0rd!`
3. Open `Queue & bays`
4. On the occupied bay, optionally click `Add service` to tack on an extra item
5. Click `Move to QC`
6. Click `Sign QC & release`

Expected result:
The bay frees up, and the customer's tracking tab (still open from A1) flips live to
"Ready for pickup" with no refresh needed.

#### A6. Confirm the live tracking update

1. Switch back to the customer tracking tab from step A1
2. Confirm the progress indicator now shows "Ready" without you refreshing the page

#### A7. Login as Cashier and invoice the visit

1. Sign out
2. Login with:
   - Email: `blackhathackers2022@gmail.com`
   - Password: `Passw0rd!`
3. Open `Billing`
4. In "Ready to invoice", find the completed job, click `Generate invoice`
5. Click the new invoice row to open it
6. Pick a payment method, enter the amount, click `Pay`

Expected result:
The invoice status changes to `PAID`. Try calling `Pay` twice with two different methods
on a fresh invoice to demonstrate a split payment.

#### A8. (Optional) Login as Admin and refund the invoice

1. Sign out
2. Login with:
   - Email: `josiaszacharie@gmail.com`
   - Password: `Passw0rd!`
3. Open `Billing` (a caption explains the list is narrowed to paid invoices only)
4. Click the invoice from A7
5. Click `Refund`

Expected result:
Invoice status changes to `REFUNDED`. This is Admin's only billing action — there is no
Generate invoice or Pay form visible anywhere on this account.

## 5. Additional Functional Tests

### Receptionist tests

1. Walk-in check-in (no prior booking): in `Queue & bays`, search a registered plate in
   "Walk-in check-in", click `Check in`
2. Assign a technician to a bay's job via the dropdown
3. Cancel a `CONFIRMED` appointment instead of checking it in
4. Search/sort the Appointments and Customers lists

### Technician tests

1. Open `Maintenance`, search a vehicle by plate, click `New inspection`
2. Fill the checklist (OK/Attention/Failed), enter DTC codes (e.g. `P0420`), mileage,
   findings, optionally attach photos, click `Save inspection`
3. Open `My Report`, change the date range, export Excel/PDF

### Cashier tests

1. Search/sort the Billing invoice list (paginated — try Prev/Next)
2. Open `My Report`, change the date range, export Excel/PDF

### Manager tests

1. Open `Inventory`: search/sort items, click `Adjust` on a row (add/remove stock with a
   reason), click `New item`
2. On an `APPROVED` purchase order, click `Receive` (stock increments automatically) —
   note Manager cannot approve a draft PO, only Admin can
3. Open `AI Insights`, click `Regenerate narrative`, click `Recompute scores`
4. Open `Reports`, change the date range, export Excel/PDF
5. Open `Queue & bays`/`Appointments`/`Billing` and confirm everything is visible
   read-only with no action buttons — Manager oversees these, it doesn't operate them

### Admin tests

1. Open `Users`, click `New user`, fill email/temp password/role, `Create`
2. Search by email / filter by role on the users table
3. Click `Deactivate` on an active user, then confirm their login is now blocked
4. Scroll the audit log (paginated, searchable, with category/date filters)
5. On a `DRAFT` purchase order in `Inventory`, click `Approve` (Admin's only inventory
   action)

### Chatbot tests (any public page, bottom-right widget)

1. Ask "what services do you offer" or "how much is a premium wash" — answers come from
   the real catalog, not invented prices
2. Type "hi, can you book me a wash tomorrow at 9am" with nothing else filled in — it
   asks for whatever's missing one piece at a time, shows a preview before booking, then
   books for real only after you confirm
3. Logged in as Manager/Admin, ask "show me a chart of our revenue" — a real chart
   renders inline; the same question logged in as Receptionist is politely refused

## 6. Password Change Test

The system has no public "forgot password" — instead, a new account always starts with a
temporary password set by Admin, and must be changed on first login.

1. Login as Admin, create a new user (`Users` → `New user`)
2. Sign out, login as that new user with the temp password
3. Confirm you land on `Set a new password`, not the normal home page — typing any other
   URL directly redirects back here too
4. Enter the temp password as "current", then a new password (8+ characters) twice
5. Click `Change password`

Expected result:
You land on the normal home page for that role, and the forced screen never appears
again for this account.

To test a **voluntary** password change (not first-login):
1. Login as any of the 6 seeded staff accounts
2. Open `Profile` → "Change password"
3. Enter the current password, then a new one twice, click `Change password`

## 7. Smoke Test Checklist

Before sign-off, confirm:

- App opens on `http://localhost:5173`
- Login works for all 6 seeded accounts
- Role-based navigation is correct (each role only sees the pages it should)
- A customer can book online and get a tracking link
- Receptionist can check in and assign a bay
- Technician can move a job to QC and sign off
- The customer's tracking page updates live with no refresh
- Cashier can generate an invoice and record a payment
- Admin can refund a paid invoice
- Customers/Billing/audit-log pagination and search work against the full seeded dataset
- A new user's first login is intercepted by the forced password-change screen
- No major UI crash happens during the flow

## 8. Important Notes

- Seeded data is large by design: 2,500 customers, ~123,000 rows total, spread across a
  year of visit history — this is what makes AI Insights and the paginated lists
  meaningful instead of toy data. `npm run db:seed` always wipes and rebuilds from
  scratch.
- The fastest path to a full demo is Flow A above (Receptionist → Technician → Cashier),
  which needs no email/2FA setup at all.
- Known gaps (backend exists, no frontend control yet): creating a supplier, creating a
  purchase order from scratch (only approve/receive of an existing one), redeeming
  loyalty points on an invoice, and the notification-broadcast feature (API only, no
  page).
