import { createServer } from "http";
import { app } from "./app.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { initSocket } from "./lib/socket.js";
import { startCronJobs } from "./jobs/cron.js";

const httpServer = createServer(app);
initSocket(httpServer);
startCronJobs();

httpServer.listen(env.port, () => {
  logger.info(`IKINAMBA server listening on http://localhost:${env.port}`);
});
