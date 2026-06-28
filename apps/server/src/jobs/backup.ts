import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "..", "..", "dev.db");
const BACKUP_DIR = path.join(__dirname, "..", "..", "backups");

/** Daily SQLite snapshot -- addresses the AS-IS finding that the paper ledger "has no backup --
 * a significant data security and business continuity risk." Keeps the last 14 days, pruning older ones. */
export async function runDailyBackup() {
  if (!fs.existsSync(DB_FILE)) {
    logger.warn("No dev.db found, skipping backup");
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(BACKUP_DIR, `ikinamba-${stamp}.db`);
  fs.copyFileSync(DB_FILE, dest);
  logger.info(`Database backed up to ${dest}`);

  const RETENTION_DAYS = 14;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const filePath = path.join(BACKUP_DIR, file);
    if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
  }
}
