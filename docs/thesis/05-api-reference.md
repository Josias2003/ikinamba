# 5. REST API Reference

All routes are mounted under `/api` in `apps/server/src/app.ts`. "Auth" = requires
`Authorization: Bearer <jwt>`; "Roles" lists which roles `requireRole(...)` accepts (blank
= public/no role check beyond optional auth). Source: `apps/server/src/routes/*.ts`.

## 5.1 Auth — `/api/auth` (`auth.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| POST | `/login` | – | – | Email+password login; returns JWT, or `401 TOTP_REQUIRED` if MFA code missing |
| POST | `/register-customer` | – | – | Public self-service customer signup |
| GET | `/me` | ✓ | any | Current user profile |
| POST | `/mfa/setup` | ✓ | staff | Generate TOTP secret + otpauth URI |
| POST | `/mfa/verify` | ✓ | staff | Confirm TOTP code, enable MFA |

## 5.2 Customers — `/api/customers` (`customers.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/` | ✓ | ADMIN, MANAGER, RECEPTIONIST, CASHIER, TECHNICIAN | Search/list customers (name/phone/plate) |
| GET | `/:id` | ✓ | same | Customer detail: vehicles, invoices, loyalty txns, AI insight |
| POST | `/` | ✓ | same | Create customer |
| PATCH | `/:id` | ✓ | same | Update customer |
| POST | `/:id/vehicles` | ✓ | same | Add vehicle to customer |

## 5.3 Vehicles — `/api/vehicles` (`vehicles.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/` | ✓ | ADMIN, MANAGER, RECEPTIONIST, CASHIER, TECHNICIAN | List/search vehicles by plate |
| GET | `/:id` | ✓ | same | Vehicle detail incl. photos + inspection history |

## 5.4 Appointments — `/api/appointments` (`appointments.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/availability` | – | – | 30-min slot availability for a date |
| POST | `/` | – | – | Public booking (inline customer/vehicle creation supported) |
| GET | `/` | ✓ | ADMIN, MANAGER, RECEPTIONIST | List appointments (optional date filter) |
| PATCH | `/:id/reschedule` | ✓ | same | Reschedule, capacity-checked |
| PATCH | `/:id/cancel` | ✓ | same | Cancel |
| POST | `/:id/check-in` | ✓ | same | Convert to live QueueEntry |

## 5.5 Queue — `/api/queue` (`queue.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/board` | ✓ | ADMIN, MANAGER, RECEPTIONIST, TECHNICIAN | Bays + waiting list |
| GET | `/technicians` | ✓ | same | Active technicians for assignment dropdown |
| POST | `/walk-in` | ✓ | ADMIN, MANAGER, RECEPTIONIST | Add walk-in vehicle to queue |
| POST | `/bays/:bayId/assign-next` | ✓ | same | Assign highest-priority waiting entry to a free bay |
| PATCH | `/:id/technician` | ✓ | staff | Assign technician to job |
| POST | `/:id/items` | ✓ | staff | Add catalog service items to job |
| PATCH | `/:id/quality-check` | ✓ | staff | Move entry to QUALITY_CHECK |
| PATCH | `/:id/sign-quality-check` | ✓ | ADMIN, MANAGER, TECHNICIAN | Mandatory QC sign-off → READY |
| PATCH | `/:id/complete` | ✓ | staff | Mark COMPLETED, release bay |

## 5.6 Bays — `/api/bays` (`bays.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/` | ✓ | ADMIN, MANAGER, RECEPTIONIST, TECHNICIAN | List bays |
| POST | `/` | ✓ | ADMIN, MANAGER | Create bay |
| PATCH | `/:id/status` | ✓ | ADMIN, MANAGER | Update bay status |

## 5.7 Maintenance — `/api/maintenance` (`maintenance.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| POST | `/inspections` | ✓ | ADMIN, MANAGER, TECHNICIAN | Create inspection (checklist, DTC codes, mileage, findings) |
| GET | `/inspections/:id` | ✓ | same | Inspection detail |
| POST | `/inspections/:id/photos` | ✓ (multer) | same | Upload up to 6 photos, 8MB max each |
| POST | `/vehicles/:vehicleId/photos` | ✓ (multer) | same | Upload intake/damage/inspection photos |

## 5.8 Tracking (public) — `/api/track` (`tracking.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/:token` | – | – | Live status for a queue entry by tracking token |
| GET | `/:token/qrcode.png` | – | – | QR image linking to the tracking page |

## 5.9 Billing — `/api/billing` (`billing.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/billable` | ✓ | ADMIN, MANAGER, CASHIER | Queue entries ready to invoice |
| POST | `/invoices` | ✓ | same | Create invoice from a queue entry (discount + loyalty redemption supported) |
| GET | `/invoices/:id` | ✓ | same | Invoice detail with items/payments |
| GET | `/invoices` | ✓ | same | List invoices (filter by status) |
| POST | `/invoices/:id/payments` | ✓ | same | Record payment (split payments supported) |
| POST | `/invoices/:id/refund` | ✓ | ADMIN, MANAGER | Refund a paid invoice |

## 5.10 Notifications — `/api/notifications` (`notifications.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/log` | ✓ | ADMIN, MANAGER, RECEPTIONIST | Notification delivery log |
| POST | `/broadcast` | ✓ | ADMIN, MANAGER | Promotional broadcast to a loyalty-tier segment |
| GET | `/messages/:customerId` | ✓ | any (own thread for customers) | Chat thread |
| POST | `/messages/:customerId` | ✓ | any (own thread for customers) | Send chat message |

## 5.11 Reports — `/api/reports` (`reports.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/dashboard` | ✓ | ADMIN, MANAGER | Revenue/popularity/peak-hours/productivity/retention metrics |
| GET | `/export/excel` | ✓ | ADMIN, MANAGER | .xlsx export (Revenue, Service Popularity, Staff Productivity sheets) |
| GET | `/export/pdf` | ✓ | ADMIN, MANAGER | PDF export |

## 5.12 Inventory — `/api/inventory` (`inventory.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/items` | ✓ | ADMIN, MANAGER | List items (optional low-stock filter) |
| POST | `/items` | ✓ | same | Create item |
| PATCH | `/items/:id/adjust` | ✓ | same | Adjust stock level |
| GET | `/suppliers` | ✓ | same | List suppliers |
| POST | `/suppliers` | ✓ | same | Create supplier |
| GET | `/purchase-orders` | ✓ | same | List POs |
| POST | `/purchase-orders` | ✓ | same | Create draft PO |
| PATCH | `/purchase-orders/:id/approve` | ✓ | same | Approve PO |
| PATCH | `/purchase-orders/:id/receive` | ✓ | same | Receive PO, increments stock |

## 5.13 Catalog — `/api/catalog` (`catalog.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/` | – | – | Public list of active service items (booking widget, chatbot) |
| POST | `/` | ✓ | ADMIN, MANAGER | Create catalog item |
| PATCH | `/:id` | ✓ | same | Update catalog item |

## 5.14 AI — `/api/ai` (`ai.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/status` | ✓ | any | Is the local Ollama server reachable |
| GET | `/insights` | ✓ | ADMIN, MANAGER | LLM-generated dashboard narrative |
| POST | `/insights/recompute` | ✓ | ADMIN, MANAGER | On-demand churn/maintenance score recompute |
| GET | `/insights/at-risk` | ✓ | ADMIN, MANAGER, RECEPTIONIST | Customers flagged MEDIUM/HIGH churn risk |
| GET | `/insights/customer/:customerId` | ✓ | any | Single-customer churn score |
| POST | `/chat` | – | – | Public chatbot, grounded in live catalog/bay data |

## 5.15 Users (admin) — `/api/users` (`users.routes.ts`)
| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/` | ✓ | ADMIN | List staff users |
| POST | `/` | ✓ | ADMIN | Create user |
| PATCH | `/:id/deactivate` | ✓ | ADMIN | Deactivate user |
| POST | `/backup` | ✓ | ADMIN | Manually trigger DB backup |
| GET | `/audit-log` | ✓ | ADMIN | Last 200 audit entries |

## 5.16 Role → endpoint-group access matrix

| Role | Customers/Vehicles | Appointments | Queue/Bays | Maintenance | Billing | Inventory | Reports/AI | Users/Audit |
|---|---|---|---|---|---|---|---|---|
| ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ (+refund) | ✓ | ✓ | ✓ |
| MANAGER | ✓ | ✓ | ✓ | ✓ | ✓ (+refund) | ✓ | ✓ | – |
| CASHIER | ✓ | – | read | – | ✓ | – | – | – |
| RECEPTIONIST | ✓ | ✓ | ✓ | – | – | – | at-risk list only | – |
| TECHNICIAN | ✓ (read) | – | ✓ | ✓ | – | – | – | – |
| CUSTOMER | self (via public endpoints) | book/own | – | – | – | – | – | – |
