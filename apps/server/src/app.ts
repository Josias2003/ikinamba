import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./lib/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.routes.js";
import { customersRouter } from "./routes/customers.routes.js";
import { vehiclesRouter } from "./routes/vehicles.routes.js";
import { appointmentsRouter } from "./routes/appointments.routes.js";
import { queueRouter } from "./routes/queue.routes.js";
import { maintenanceRouter } from "./routes/maintenance.routes.js";
import { trackingRouter } from "./routes/tracking.routes.js";
import { billingRouter } from "./routes/billing.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { inventoryRouter } from "./routes/inventory.routes.js";
import { aiRouter } from "./routes/ai.routes.js";
import { catalogRouter } from "./routes/catalog.routes.js";
import { baysRouter } from "./routes/bays.routes.js";
import { usersRouter } from "./routes/users.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/customers", customersRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/queue", queueRouter);
app.use("/api/maintenance", maintenanceRouter);
app.use("/api/track", trackingRouter);
app.use("/api/billing", billingRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/ai", aiRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/bays", baysRouter);
app.use("/api/users", usersRouter);

app.use(notFoundHandler);
app.use(errorHandler);
