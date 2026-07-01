# IKINAMBA — Smart Car Wash Management System

A full-stack web application for **New Class Car Wash** (Gisimenti, Kigali, Rwanda).
It handles online bookings, live queue management, payments, inventory, AI-powered
chatbot assistance, and real-time vehicle tracking — all from one system.

---

## What the system does

| Who | What they can do |
|---|---|
| **Customer** | Book a car wash online without an account, track their vehicle live, pay via MTN MoMo |
| **Receptionist** | Check in vehicles, manage the appointment queue, assign bays |
| **Technician** | Move vehicles through service stages, run maintenance inspections, sign off quality control |
| **Cashier** | Generate invoices, record payments (cash, MoMo, card), issue refunds |
| **Manager** | View reports, manage inventory, read AI-generated business insights |
| **Admin** | Create/deactivate user accounts, review the audit log, oversee everything |

**Key features:**
- Online booking with returning-customer auto-fill (type your email → your details fill in automatically)
- Real-time vehicle tracking via QR code — customers watch their car move through stages live
- AI chatbot that can book appointments, answer pricing questions, and check vehicle status by plate number
- MTN MoMo sandbox payment integration
- Email notifications (booking confirmation, cancellation, ready-for-pickup)
- Role-based access control — each staff role sees only what it needs
- Maintenance inspection module with DTC fault codes
- Inventory management with low-stock alerts
- PDF and Excel report exports

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query |
| Backend | Node.js, Express, TypeScript |
| Database | MySQL 8 via Prisma ORM |
| Real-time | Socket.IO |
| AI chatbot | Ollama (local LLM, model: ikinamba-ai based on Qwen 2.5) |
| Email | Brevo transactional email API + Gmail SMTP fallback |
| Payments | MTN MoMo Collections API (sandbox) |
| Auth | JWT (access token in cookie) |

---

## Project structure

```
ikinamba/
├── apps/
│   ├── server/          ← Node.js/Express API (port 4000)
│   │   ├── prisma/      ← Database schema and migrations
│   │   ├── src/
│   │   │   ├── ai/      ← Chatbot engine and tools
│   │   │   ├── lib/     ← env, mailer, prisma client
│   │   │   ├── middleware/
│   │   │   ├── routes/
│   │   │   └── services/
│   │   └── .env         ← Your local config (never committed)
│   └── web/             ← React SPA (port 5173)
│       └── src/
│           ├── components/
│           ├── pages/
│           └── lib/
├── TESTING_GUIDE.md     ← Step-by-step guide to run and test everything
└── README.md            ← This file
```

---

## Quick start

### Requirements

- Node.js 20 LTS — [nodejs.org](https://nodejs.org)
- MySQL 8 — [dev.mysql.com/downloads](https://dev.mysql.com/downloads/installer)
- Git

### 1. Clone and install

```bash
git clone https://github.com/Josias2003/ikinamba.git
cd ikinamba
npm install
```

### 2. Create the database

In MySQL Workbench or any MySQL client:
```sql
CREATE DATABASE ikinamba CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. Configure environment variables

```bash
cp apps/server/.env.example apps/server/.env
```

Open `apps/server/.env` and set at minimum:

```env
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/ikinamba"
JWT_SECRET="any-random-string-here"
BREVO_API_KEY=<get this from the project owner>
BREVO_FROM=your-email@gmail.com
```

### 4. Migrate and seed the database

```bash
cd apps/server
npx prisma migrate deploy
npm run db:seed
cd ../..
```

Seeding creates 2,500 demo customers, vehicles, visit history, and all staff accounts.
**Wait for it to finish — it takes 3–5 minutes.**

### 5. Start the app

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## Staff login accounts

All demo accounts use password: **`Passw0rd!`**

| Role | Email |
|---|---|
| Admin | `josiaszacharie@gmail.com` |
| Manager | `vianew440@gmail.com` |
| Receptionist | `bikomeye9@gmail.com` |
| Cashier | `blackhathackers2022@gmail.com` |
| Technician | `sindnepom@gmail.com` |

---

## Customer booking (no account needed)

Go to **http://localhost:5173/book**

- Fill in email, name, phone, vehicle details
- Choose services and a time slot
- You get a QR code to track your vehicle live
- A confirmation email is sent automatically

**Returning customer?** Just type your email and press Tab — name, phone, and vehicle fill in automatically.

---

## AI chatbot

The chat button appears in the bottom-right corner of the booking page.
It can book appointments through conversation, answer pricing questions, and look up
any vehicle's current wash status by plate number.

The chatbot requires Ollama running locally:
```bash
ollama pull qwen2.5:1.5b-instruct
ollama create ikinamba-ai -f apps/server/ollama/Modelfile
```

Everything else works without the chatbot.

---

## Testing guide

See **[TESTING_GUIDE.md](TESTING_GUIDE.md)** for a complete walkthrough:
- Full vehicle visit flow (booking → check-in → service → QC → payment → release)
- All 5 staff roles tested step by step
- Chatbot booking and vehicle status check
- MoMo sandbox payment with test phone numbers
- LAN/phone access instructions
- Troubleshooting common errors

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | MySQL connection string |
| `JWT_SECRET` | Yes | Any secret string for signing tokens |
| `BREVO_API_KEY` | Yes* | Brevo email API key (*or set SMTP instead) |
| `BREVO_FROM` | Yes* | Sender email address registered in Brevo |
| `SMTP_HOST` | No | Gmail/other SMTP host (fallback if Brevo not set) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password or app password |
| `OLLAMA_BASE_URL` | No | Ollama endpoint, default `http://localhost:11434` |
| `OLLAMA_MODEL` | No | Model name, default `ikinamba-ai` |
| `APP_URL` | No | Public URL for email links (auto-detected in dev) |
| `CLIENT_ORIGIN` | No | Comma-separated CORS origins (auto-detected in dev) |
| `MOMO_*` | No | MTN MoMo API credentials (sandbox values in .env.example) |

---

## Deployment (Render + Railway)

1. Push your code to GitHub
2. Create a MySQL database on [Railway](https://railway.app) — copy the connection string
3. Create a **Web Service** on [Render](https://render.com):
   - Build command: `npm install && cd apps/server && npx prisma migrate deploy && npm run build`
   - Start command: `node apps/server/dist/index.js`
   - Add all environment variables from `.env` (use the Railway `DATABASE_URL`)
   - Set `APP_URL` to your Render service URL
4. Create a **Static Site** on Render for the frontend:
   - Build command: `npm install && npm run build -w apps/web`
   - Publish directory: `apps/web/dist`
   - Add `VITE_API_URL` = your backend Render URL
5. Set `CLIENT_ORIGIN` on the backend = your frontend Render URL

---

## License

Academic project — New Class Car Wash, Kigali, Rwanda.
