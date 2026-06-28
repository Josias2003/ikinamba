import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "./env.js";
import type { Role } from "../types/enums.js";

export interface AuthTokenPayload {
  sub: string; // user id
  role: Role;
  customerId?: string | null;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const signToken = (payload: AuthTokenPayload) =>
  jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });

export const verifyToken = (token: string): AuthTokenPayload => jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
