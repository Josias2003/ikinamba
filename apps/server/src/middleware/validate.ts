import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { badRequest } from "../lib/errors.js";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(badRequest(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
    }
    req.body = result.data;
    next();
  };
}
