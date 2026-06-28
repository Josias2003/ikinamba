import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  logger.error(err);
  res.status(500).json({ error: "Internal server error" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}
