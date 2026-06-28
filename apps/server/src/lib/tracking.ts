import crypto from "crypto";
import QRCode from "qrcode";
import { env } from "./env.js";

export function newTrackingToken() {
  return crypto.randomBytes(12).toString("hex");
}

export function trackingUrl(token: string) {
  return `${env.clientOrigin}/track/${token}`;
}

/** Inline QR attachment for the tracking link, referenced in email HTML via `cid:qrcode`. */
export async function qrAttachment(token: string) {
  const content = await QRCode.toBuffer(trackingUrl(token), { width: 320 });
  return { filename: "qrcode.png", content, cid: "qrcode" };
}
