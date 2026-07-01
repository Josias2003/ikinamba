# IKINAMBA - New Class Car Wash: Complete Testing Guide

This guide is written for someone who has never seen this project before.
Follow every step in order and you will see every feature working.

---

## PART 1 - Setup (do this once)

### 1. Install required software

Install all of these before anything else:

| Software | Where to get it | Notes |
|---|---|---|
| **Node.js 20 LTS** | nodejs.org | Pick the LTS version |
| **MySQL 8** | dev.mysql.com/downloads/installer | Choose "Developer Default" setup |
| **Git** | git-scm.com | Accept all defaults |
| **Ollama** | ollama.com | Needed only for the AI chatbot |

After installing Node.js, open a terminal and confirm:
```
node -v     should say v20.x.x or higher
npm -v      should say 10.x.x or higher
```

---

### 2. Clone the project

```bash
git clone https://github.com/Josias2003/ikinamba.git
cd ikinamba
```

---

### 3. Create the MySQL database

Open MySQL Workbench, connect to your local server, and run:
```sql
CREATE DATABASE ikinamba CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

### 4. Configure environment variables

Copy the example file:
```bash
cp apps/server/.env.example apps/server/.env
```

Open `apps/server/.env` and fill in these values (edit with any text editor):

```env
DATABASE_URL="mysql://root:YOUR_MYSQL_PASSWORD@localhost:3306/ikinamba"
JWT_SECRET="testing-secret-key-change-in-production"

SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail@gmail.com
SMTP_PASS="your-gmail-app-password"
SMTP_FROM="New Class Car Wash <your-gmail@gmail.com>"

BREVO_API_KEY=<ask the project owner for this key>
BREVO_FROM=josiaszacharie@gmail.com
BREVO_SENDER_NAME="New Class Car Wash"
```

> **Email**: The app uses Brevo to send confirmation emails. Get the API key from the
> project owner. Set `BREVO_FROM` to an email address you can actually check.

> **SMTP**: Gmail SMTP above is a backup transport. For a Gmail app password:
> Google Account -> Security -> 2-Step Verification -> App passwords -> generate one.

> **MoMo sandbox credentials** - these are in `.env.example` already. Copy them as-is;
> they are the standard MTN sandbox test values.

---

### 5. Install dependencies

From the project root:
```bash
npm install
```

---

### 6. Run database migrations and seed demo data

```bash
cd apps/server
npx prisma migrate deploy
npm run db:seed
cd ../..
```

`db:seed` creates 2,500 demo customers, vehicles, visit history, and all staff accounts.
**This takes 3 to 5 minutes - let it finish completely before proceeding.**

---

### 7. Set up the AI chatbot model (optional but recommended)

```bash
ollama pull qwen2.5:1.5b-instruct
ollama create ikinamba-ai -f apps/server/ollama/Modelfile
```

Skip this if you only want to test the rest of the features - everything except the
chat widget works without Ollama.

---

### 8. Start the app

```bash
npm run dev
```

Wait until you see both:
```
[server] IKINAMBA server listening on http://localhost:4000
[web]    Local: http://localhost:5173/
```

Open **http://localhost:5173** in your browser.

---

## PART 2 - Staff Login Accounts

All accounts use password: **`Passw0rd!`**

| Role | Email | What they can do |
|---|---|---|
| **Admin** | `josiaszacharie@gmail.com` | User management, audit log, approve purchase orders, refunds |
| **Manager** | `vianew440@gmail.com` | Reports, inventory, revenue chart, read-only floor view |
| **Receptionist** | `bikomeye9@gmail.com` | Bookings, check-in, queue management |
| **Cashier** | `blackhathackers2022@gmail.com` | Billing, invoices, payments |
| **Technician** | `sindnepom@gmail.com` | Queue board, maintenance inspections, QC sign-off |

---

## PART 3 - Full Customer Visit Flow (most important test)

This walks a vehicle from booking all the way to payment and release.
Use separate browser tabs for different roles so you don't have to log in and out constantly.

---

### Step 1 - Customer books online (no login needed)

1. Open **http://localhost:5173/book** in a new tab (or incognito)
2. Fill in the form with these test values:

   **Your details (section 1):**
   | Field | Value |
   |---|---|
   | Email | `testcustomer@gmail.com` *(use a real email you can check)* |
   | Full name | `Alice Uwimana` |
   | Phone | `0781234567` |

   **Vehicle:**
   | Field | Value |
   |---|---|
   | Vehicle make | `Toyota` |
   | Vehicle model | `Corolla` |
   | Plate number | `RAD 123 A` |
   | Year | `2020` |

3. Tick **Full Car Wash** and **Interior Cleaning** under "Choose services"
4. Pick **today's date** and any available time slot
5. Click **Confirm booking**

**Expected:** Confirmation screen appears with a QR code and tracking link.
**Keep this tab open** - you will watch it update live in Step 5.

> **Email test:** Check the email address you entered. A booking confirmation email with
> the tracking QR code should arrive within 1 minute (via Brevo).

---

### Step 2 - Try returning customer auto-fill

1. Open **http://localhost:5173/book** again (new tab)
2. Type `testcustomer@gmail.com` in the Email field and press **Tab**
3. Watch - name, phone, and vehicle should fill in automatically
4. You only need to pick a service and time

**Expected:** "Welcome back, Alice Uwimana! We've filled in your details." banner appears.

---

### Step 3 - Receptionist checks in the booking

1. Open **http://localhost:5173/login** - log in as Receptionist (`bikomeye9@gmail.com` / `Passw0rd!`)
2. Click **Bookings** in the sidebar
3. Find today's booking for Alice Uwimana (status: CONFIRMED)
4. Click **Check in**

**Expected:** A QR code modal appears. The entry moves to the live queue.

---

### Step 4 - Receptionist assigns vehicle to a bay

1. Click **Queue & bays** in the sidebar
2. On an idle bay card, click **Assign next waiting vehicle**

**Expected:** Alice's Toyota Corolla appears on the bay with a live timer.

---

### Step 5 - Technician services the vehicle

1. Log in as Technician (`sindnepom@gmail.com` / `Passw0rd!`) in a different tab
2. Open **Queue & bays**
3. On the occupied bay, click **Move to QC**
4. Click **Sign QC & release**

**Expected:** The bay frees up. Switch to the tracking tab from Step 1 - it should update
live to "Ready for pickup" **without refreshing the page**.

---

### Step 6 - Cashier invoices and takes payment

1. Log in as Cashier (`blackhathackers2022@gmail.com` / `Passw0rd!`)
2. Open **Billing**
3. Under "Ready to invoice", find Alice's completed job - click **Generate invoice**
4. Click the invoice row to open it
5. Select payment method **CASH**, enter the amount shown, click **Pay**

**Expected:** Invoice status changes to **PAID**.

---

### Step 7 - Release the vehicle (finance gate)

1. Before paying - try clicking **Complete** (or **Scan to pick up** with the QR) while
   the invoice is still unpaid. Confirm you get a clear error message.
2. After Step 6 (paid) - do the same action. Vehicle releases successfully.

---

### Step 8 - (Optional) Admin refunds the invoice

1. Log in as Admin (`josiaszacharie@gmail.com` / `Passw0rd!`)
2. Open **Billing** - find Alice's paid invoice - click **Refund**

**Expected:** Status changes to **REFUNDED**.

---

## PART 4 - Chatbot Tests

Open **http://localhost:5173/book** - the chat widget is in the bottom-right corner.
*(Requires Ollama running with the ikinamba-ai model from Part 1 Step 7.)*

### Test A - Service price enquiry
Type: `How much is a full car wash?`
**Expected:** Bot answers with the real price from the catalog, not a made-up number.

### Test B - New customer booking via chat
Type these messages one at a time and wait for each reply:
```
I'd like to book a car wash
testchat@gmail.com
My name is John Mugisha
0789876543
Toyota RAV4
RAV 456 B
Full Car Wash
Tomorrow at 10am
```
**Expected:** Bot collects all fields, shows a booking preview, then books for real after you say "yes".

### Test C - Returning customer booking via chat
(After Test B has run at least once, or after Step 1 above)
Type: `I want to book. My email is testcustomer@gmail.com`
**Expected:** Bot finds Alice's record and skips asking for name/phone/vehicle.
It should only ask for service and date.

### Test D - Vehicle status check (with display card)
Type: `What is the status of plate RAD 123 A?`
**Expected:** Bot returns the current stage AND a status card shows inline with the stage
badge (Waiting / In service / Quality check / Ready), bay name, and services list.

### Test E - Check availability before booking
Type: `Are you free this Saturday?`
**Expected:** Bot shows a grid of available time slots for Saturday inline in the chat.
You can then say `Book me at 10am` and continue the booking flow.

### Test F - Returning customer confirms their booking
Type: `Did my booking go through? My email is testcustomer@gmail.com`
**Expected:** Bot finds Alice's appointment and shows a confirmation card with service,
vehicle, date/time, and the tracking QR code - all without asking a single extra question.

### Test G - Staff-only tool (access control)
Log in as Manager, open the chat, type: `Show me revenue chart`
**Expected:** A revenue chart renders inline.
Log out, open the public chatbot, type the same - **Expected:** politely refused.

### Test H - Voice input (impressive live demo)
On Chrome or Edge (voice is not supported in Firefox):
Click the microphone button in the chat and say: `I want to book a full car wash tomorrow`
**Expected:** Your speech appears as text in the input box. Press Send and the bot starts
the booking flow. This is the only feature that needs Chrome/Edge - everything else works
in any browser.

---

## PART 5 - MoMo Sandbox Payment Test

After completing a booking (Step 1), the confirmation screen shows "Pay with MoMo now".

### Test phone numbers

| Number | What happens |
|---|---|
| `0461733123` | Payment SUCCESSFUL |
| `0461733124` | Payment FAILED (declined) |

> These are MTN sandbox test numbers. Real Rwandan numbers do not work in sandbox mode.
> The pay button is disabled unless the number starts with 078 or 079 (MTN).
> If you type a 072 or 073 (Airtel) number, you will see a message saying it is not supported.

### Steps

1. After booking, on the confirmation screen, enter `0461733123` in the MoMo field
2. Click **Pay**
3. Wait up to 60 seconds for the sandbox to respond

**Expected (success):** Message "Paid via MoMo - you're all set, no need to pay at pickup."
**Expected (declined):** Error message and "you can still pay at pickup" fallback.

---

### How to verify the MoMo payment and show proof to supervisors

There are four things you can show to prove the MoMo integration is working:

**1. The app confirmation message**
After clicking Pay with `0461733123`, the section changes to a green tick and the text
"Paid via MoMo - you're all set." Take a screenshot of this.

**2. The invoice in the Billing panel**
Log in as Cashier. Open **Billing** and find Alice's invoice.
The status column should show **PAID** and the payment method should show **MOMO**.
Take a screenshot of the invoice detail page.

**3. The server terminal log**
In the terminal where you ran `npm run dev`, you will see lines similar to:
```
INFO: MoMo requesttopay sent  referenceId=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
INFO: MoMo status SUCCESSFUL  referenceId=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```
This shows the actual API call to MTN's sandbox and the response. Take a screenshot of these lines.

**4. Verify via the MTN Developer Portal (optional, strongest proof)**
If you want to show the transaction was recorded on MTN's side:
1. Go to **developers.mtn.com** and log in with the MTN developer account
2. Click **My Apps** at the top
3. Open the app that has the Collections subscription
4. Click **Collections** product - then **Sandbox** - then **Try it out**
5. Use the endpoint `GET /collection/v1_0/requesttopay/{referenceId}` and paste the
   `referenceId` printed in the terminal log above
6. Click **Execute** - the response body will show `"status": "SUCCESSFUL"` with
   the amount, currency, and payer number. This is the live sandbox record.
   Take a screenshot of this response.

**What to show a supervisor in 2 minutes:**
Open the Billing panel as Cashier (shows PAID/MOMO), then show the terminal log with
the referenceId, and finally show the green "Paid via MoMo" confirmation. That is
enough to demonstrate the full payment cycle without needing the developer portal.

---

## PART 6 - Other Features to Test

### Receptionist
- Walk-in check-in: Queue & bays -> search plate `RAD 001 A` -> Check in (no prior booking needed)
- Cancel a confirmed appointment: Bookings -> find one -> Cancel
- Reschedule an appointment to a different date

### Technician
- Open **Maintenance** -> search plate `RAD 001 A` -> **New inspection**
- Fill the checklist (set some items to Attention or Failed)
- Enter DTC code `P0420`, mileage `45000`
- Add findings text, click **Save inspection**
- Open **My Report**, change date range, export PDF

### Cashier
- Open **Billing** -> try Prev/Next pagination (2,500 customers = many invoices)
- Export invoice list to Excel/PDF
- Record a split payment: Cash + MoMo on the same invoice

### Manager
- Open **Inventory** -> click **Adjust** on any item -> add 10 units with reason "Restock"
- Open **AI Insights** -> click **Regenerate narrative** -> wait for the AI summary
- Open **Reports** -> change date range -> export Excel/PDF
- Confirm Manager can VIEW Queue, Appointments, and Billing but has NO action buttons

### Admin
- Open **Users** -> **New user**: email `newstaff@test.com`, temp password `Test1234!`, role Receptionist
- Log out -> log in as `newstaff@test.com` with `Test1234!`
- **Expected:** Forced password-change screen (cannot skip or navigate away)
- Change password -> confirm you land on the home page normally
- Back as Admin -> **Deactivate** the new account -> try logging in as them -> **Expected:** blocked

---

## PART 7 - Phone (LAN) Access Test

The server auto-detects your WiFi IP. Check the startup log:
```
INFO: Tracking links / QR codes -> http://192.168.x.x:5173
```

On your phone (connected to the same WiFi), open that URL.
The full app - booking form, chatbot, tracking pages - should work on the phone browser.

**To test QR scanning on mobile:**
1. Complete Step 1 (booking) on the phone
2. The confirmation email contains a QR code
3. Scan it with the phone camera - it should open the live tracking page

---

## PART 8 - Smoke Checklist

Before sign-off, confirm every item:

- [ ] App loads at http://localhost:5173
- [ ] All 5 staff accounts log in with Passw0rd!
- [ ] Each role only sees the navigation items it should
- [ ] Public booking form works (new customer)
- [ ] Returning customer email auto-fills name/phone/vehicle
- [ ] Booking confirmation email arrives with tracking QR
- [ ] Receptionist can check in and assign a bay
- [ ] Technician can move to QC and sign off
- [ ] Live tracking updates without page refresh
- [ ] Vehicle cannot be released until invoice is paid
- [ ] Cashier can generate invoice and record payment
- [ ] Admin can refund a paid invoice
- [ ] Chatbot books a real appointment (saved to DB, confirmation email sent)
- [ ] Chatbot checks vehicle status by plate
- [ ] MoMo pay button disabled for non-078/079 numbers
- [ ] Pagination works on Customers and Billing lists
- [ ] New user forced-password-change flow works
- [ ] Deactivated account cannot log in

---

## Troubleshooting

**"Cannot connect to database"** - check `DATABASE_URL` in `apps/server/.env`, confirm MySQL is running, confirm the `ikinamba` database exists.

**"Port 4000 already in use"** - another server is running. In an admin terminal: `netstat -ano | findstr :4000` then `taskkill /PID <number> /F`.

**"Port 5173 already in use"** - same as above but for port 5173.

**Emails not arriving** - check spam. Confirm `BREVO_FROM` is a verified sender in your Brevo account (brevo.com -> Settings -> Senders & IP). If using Gmail SMTP, confirm the app password is correct and 2FA is enabled on the Google account.

**Chatbot says "technical issue"** - Ollama is not running or the model is not installed. Run `ollama list` - you should see `ikinamba-ai`. If not, repeat Part 1 Step 7.

**MoMo payment always pending / times out** - the sandbox can be slow. Wait the full 60 seconds. If it always fails, confirm the MoMo env vars match exactly what is in `.env.example`.
