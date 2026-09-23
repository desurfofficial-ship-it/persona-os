/**
 * Stateless signed session tokens for the local preview backend.
 *
 * Format: `<userId>.<hex hmac>` — HMAC-SHA256 of the userId with a stable
 * secret. Survives server restarts without a session table, which is all the
 * preview needs. The real deployment uses Supabase Auth; these helpers are
 * only imported by /api/local-* routes and never by page code.
 */
import crypto from "crypto";

const SECRET =
  process.env.LOCAL_SESSION_SECRET || "persona-os-preview-secret-do-not-use-in-prod";

export function hashPassword(password: string, salt?: string): string {
  const s = salt || crypto.randomBytes(8).toString("hex");
  const digest = crypto.createHash("sha256").update(`${s}:${password}`).digest("hex");
  return `${s}:${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt] = stored.split(":");
  if (!salt) return false;
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signToken(userId: string): string {
  const mac = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}.${mac}`;
}

export function verifyToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return userId;
}

/** Extract + verify the Bearer token from a Request. Returns userId or null. */
export function userFromRequest(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyToken(match[1].trim());
}
