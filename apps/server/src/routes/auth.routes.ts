import { Router } from "express";
import { z } from "zod";
import { authenticator } from "otplib";
import QRCode from "qrcode";
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
    if (!user || !user.isActive) {
      // Record the attempt even though there's no user row to attach it to cleanly --
      // a string of these against the same email is exactly the "someone tried to log in
      // 3 times" signal the audit log needs to surface.
      await recordAudit({ action: "FAILED_LOGIN", entity: "User", metadata: { email } });
      throw unauthorized("Invalid credentials");
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      await recordAudit({ userId: user.id, action: "FAILED_LOGIN", entity: "User", entityId: user.id, metadata: { email } });
      throw unauthorized("Invalid credentials");
    }

    if (STAFF_ROLES.includes(user.role as any) && user.totpEnabled) {
      if (!totpCode) return res.status(401).json({ error: "TOTP_REQUIRED" });
      const valid = authenticator.check(totpCode, user.totpSecret!);
      if (!valid) {
        await recordAudit({ userId: user.id, action: "FAILED_LOGIN", entity: "User", entityId: user.id, metadata: { email, reason: "bad_totp" } });
        throw unauthorized("Invalid authentication code");
      }
    }

    const token = signToken({ sub: user.id, role: user.role as any, customerId: user.customerId });
    await recordAudit({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id });

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, customerId: user.customerId, mustChangePassword: user.mustChangePassword },
    });
  })
);

authRouter.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await recordAudit({ userId: req.user!.sub, action: "LOGOUT", entity: "User", entityId: req.user!.sub });
    res.status(204).end();
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

const ME_SELECT = { id: true, email: true, role: true, customerId: true, totpEnabled: true, name: true, phone: true, notifyEmail: true, mustChangePassword: true } as const;

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: ME_SELECT });
    if (!user) throw unauthorized();
    res.json(user);
  })
);

// Self-service profile update -- only ever touches the caller's own row, so no role
// restriction beyond being logged in at all.
authRouter.patch(
  "/me",
  authenticate,
  validateBody(z.object({ name: z.string().optional(), phone: z.string().optional(), notifyEmail: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({ where: { id: req.user!.sub }, data: req.body, select: ME_SELECT });
    res.json(user);
  })
);

// Serves both the forced first-login change and any later voluntary change from
// Profile -- same action either way, just a different entry point on the frontend.
authRouter.post(
  "/change-password",
  authenticate,
  validateBody(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw unauthorized();
    const ok = await verifyPassword(req.body.currentPassword, user.passwordHash);
    if (!ok) throw unauthorized("Current password is incorrect");
    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await recordAudit({ userId: user.id, action: "CHANGE_PASSWORD", entity: "User", entityId: user.id });
    res.json({ ok: true });
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
    // Data-URI QR so the frontend can render an <img> directly -- no separate endpoint
    // that would otherwise need the secret/otpauth passed back through a URL.
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    res.json({ secret, otpauth, qrDataUrl });
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

// Disabling 2FA requires a current code, not just the session -- proves the requester
// still controls the authenticator rather than e.g. an unattended logged-in browser.
authRouter.post(
  "/mfa/disable",
  authenticate,
  validateBody(z.object({ code: z.string() })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user?.totpEnabled || !user.totpSecret) throw badRequest("2FA is not enabled");
    const valid = authenticator.check(req.body.code, user.totpSecret);
    if (!valid) throw unauthorized("Invalid code");
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } });
    res.json({ ok: true });
  })
);
