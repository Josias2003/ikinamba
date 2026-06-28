# IKINAMBA — Thesis Documentation Pack

This folder documents the **as-built** IKINAMBA system (the code in `apps/server` and
`apps/web`) so it can be lifted into the final project report (KARIZA Denyse, ID 20635,
Adventist University of Central Africa, Faculty of IT — Networks and Communication
Systems). It is organized to match the chapter structure used in the department's thesis
template ("Final project by DENYSE.docx") and the approved proposal
("FinalProjectProposalBook.docx" / "20635_Requirements.docx").

## What's safe to copy in directly vs. what you still need to write yourself

These files describe **what the system does and how it is built** — that part is derived
from the actual code, so it's factually accurate and citable. They do **not** invent your
business-research narrative: the historical background of New Class Car Wash, the
interview/observation findings, the AS-IS PIECES analysis, and the Gantt chart/timeline
are your own fieldwork and belong in Chapter 1–2 as you already drafted them in the
proposal. Use these documents to write the parts that depend on the *implementation*
(Chapters 3 and 4 mainly), and the data/diagrams you need to redraw as figures (use case
diagrams, ER diagrams, screenshots).

## File map → thesis chapters

| File | Thesis section it supports |
|---|---|
| [01-system-overview.md](01-system-overview.md) | Ch.1 Objectives → "what was actually delivered" mapping; Ch.2 Proposed Solutions / module list; List of Abbreviations |
| [02-architecture.md](02-architecture.md) | Ch.3 "System Architectural Design"; Ch.4 "Technologies Used" |
| [03-data-dictionary.md](03-data-dictionary.md) | Ch.3 "Data Dictionary" + material for the ER/Class diagram figure |
| [04-use-cases-and-workflows.md](04-use-cases-and-workflows.md) | Ch.3 "Use Case Diagram", "Use Case Description" tables, "Sequence Diagram", "Activity Diagram" |
| [05-api-reference.md](05-api-reference.md) | Appendix material backing Ch.4 implementation claims; supports the class/sequence diagrams |
| [06-ai-ml-module.md](06-ai-ml-module.md) | Ch.4 "Technologies Used" (AI subsystem is the most original technical contribution — worth its own subsection) |
| [07-testing-and-screens.md](07-testing-and-screens.md) | Ch.4 "Software Testing" and "Presentation of the New System" (drop your own screenshots into the slots listed here) |
| [08-demo-script.md](08-demo-script.md) | Practice/defense rehearsal — full click-by-click script for every page/action, a role→page access map, credentials, and an honest list of UI gaps to avoid promising live |

## Quick facts to keep consistent across chapters

- **Project name:** IKINAMBA — Smart Vehicle Service & Car Wash Management System
- **Case study organization:** New Class Car Wash, Gisimenti, Kigali, Rwanda
- **Architecture:** Monorepo, two workspaces — `apps/server` (Node.js/Express/TypeScript API) and `apps/web` (React/Vite/TypeScript SPA)
- **Database:** SQLite via Prisma ORM in development (`apps/server/prisma/schema.prisma`), portable to PostgreSQL by changing one `provider` line + `DATABASE_URL`
- **Roles implemented:** ADMIN, MANAGER, CASHIER, RECEPTIONIST, TECHNICIAN, CUSTOMER
- **10 functional modules implemented:** Customer & Vehicle Management, Service Booking & Appointments, Car Wash Queue & Bay Management, Vehicle Maintenance, Real-Time Service Tracking, Payment & Billing, Notifications & Communication, Reporting & Analytics, Inventory & Resource Management, Security & Access Control — matching the 10 modules in the approved proposal one-to-one (see [01-system-overview.md](01-system-overview.md))
