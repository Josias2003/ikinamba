import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthTokenPayload } from "../lib/auth.js";
import { unauthorized, forbidden } from "../lib/errors.js";
import type { Role } from "../types/enums.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized("Missing bearer token"));
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
}

/** Like authenticate, but never rejects -- attaches req.user if a valid bearer token is
 * present, otherwise leaves it undefined and lets the request through anonymously. Used
 * by routes that serve both logged-in staff and anonymous public users from the same
 * endpoint (e.g. the chatbot), where the response is scoped by role if known. */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch {
      // invalid/expired token -- proceed anonymously rather than rejecting
    }
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden(`Requires role: ${roles.join(", ")}`));
    next();
  };
}
