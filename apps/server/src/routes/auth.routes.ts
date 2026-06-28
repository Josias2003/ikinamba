import { Router } from "express";
import { z } from "zod";
import { authenticator } from "otplib";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, signToken } from "../lib/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { STAFF_ROLES } from "../types/enums.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password, totpCode } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) throw unauthorized("Invalid credentials");

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid credentials");

    if (STAFF_ROLES.includes(user.role as any) && user.totpEnabled) {
      if (!totpCode) return res.status(401).json({ error: "TOTP_REQUIRED" });
      const valid = authenticator.check(totpCode, user.totpSecret!);
      if (!valid) throw unauthorized("Invalid authentication code");
    }

    const token = signToken({ sub: user.id, role: user.role as any, customerId: user.customerId });
    await recordAudit({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id });

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, customerId: user.customerId },
    });
  })
);

const registerCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email(),
  password: z.string().min(8),
  address: z.string().optional(),
});

// Self-service customer registration -- no MFA, lightweight, matches the
// "customer auth is optional" decision (booking/tracking never requires login).
authRouter.post(
  "/register-customer",
  validateBody(registerCustomerSchema),
  asyncHandler(async (req, res) => {
    const { name, phone, email, password, address } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw badRequest("Email already registered");

    const passwordHash = await hashPassword(password);
    const customer = await prisma.customer.create({ data: { name, phone, email, address } });
    const user = await prisma.user.create({
      data: { email, passwordHash, role: "CUSTOMER", customerId: customer.id },
    });

    const token = signToken({ sub: user.id, role: "CUSTOMER", customerId: customer.id });
    res.status(201).json({ token, user: { id: user.id, email, role: "CUSTOMER", customerId: customer.id } });
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, email: true, role: true, customerId: true, totpEnabled: true },
    });
    if (!user) throw unauthorized();
    res.json(user);
  })
);

// MFA enrollment for staff roles.
authRouter.post(
  "/mfa/setup",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!STAFF_ROLES.includes(req.user!.role as any)) throw badRequest("MFA is only applicable to staff roles");
    const secret = authenticator.generateSecret();
    await prisma.user.update({ where: { id: req.user!.sub }, data: { totpSecret: secret } });
    const otpauth = authenticator.keyuri(req.user!.sub, "IKINAMBA", secret);
    res.json({ secret, otpauth });
  })
);

authRouter.post(
  "/mfa/verify",
  authenticate,
  validateBody(z.object({ code: z.string() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user?.totpSecret) throw badRequest("Run /mfa/setup first");
    const valid = authenticator.check(req.body.code, user.totpSecret);
    if (!valid) throw unauthorized("Invalid code");
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    res.json({ ok: true });
  })
);
