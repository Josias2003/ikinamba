import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/** Flags inventory items at/below their reorder threshold. Manager-facing alerts are read via GET /api/inventory?lowStock=true rather than pushed, keeping this job side-effect-free besides logging.
 * Prisma/SQLite can't compare two columns in a `where` filter, so we filter the (small SME-scale) table in memory. */
export async function checkLowStock() {
  const items = await prisma.inventoryItem.findMany();
  const lowStockItems = items.filter((item) => item.stockLevel <= item.reorderThreshold);
  if (lowStockItems.length) {
    logger.warn(`${lowStockItems.length} inventory item(s) at/below reorder threshold`);
  }
}
