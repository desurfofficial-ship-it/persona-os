/**
 * Stateless signed session tokens for the local preview backend.
 *
 * Format: `<userId>.<hex hmac>` — HMAC-SHA256 of the userId with a stable
 * secret. Survives server restarts without a session table.
 *
 * Production deployments should use Supabase Auth (or similar) instead of
 * these helpers. If LOCAL_SESSION_SECRET is missing or still the default
 * outside development, token verification fails closed.
 */
import crypto from "crypto";

const DEFAULT_SECRET = "persona-os-preview-secret-do-not-use-in-prod";

function getSecret(): string {
  const fromEnv = process.env.LOCAL_SESSION_SECRET?.trim();
  if (fromEnv && fromEnv !== DEFAULT_SECRET && fromEnv.length >= 16) {
    return fromEnv;
  }

  // Allow default only in explicit development / when NODE_ENV is unset on local machines
  const isDev =
    process.env.NODE_ENV === "development" || process.env.ALLOW_INSECURE_LOCAL_AUTH === "1";

  if (isDev) {
    if (!fromEnv || fromEnv === DEFAULT_SECRET) {
      console.warn(
        "[persona-os] Using default LOCAL_SESSION_SECRET — set a real secret before any public deploy."
      );
    }
    return fromEnv && fromEnv.length >= 8 ? fromEnv : DEFAULT_SECRET;
  }

  // Production / preview without a proper secret: fail closed (no valid tokens)
  console.error(
    "[persona-os] LOCAL_SESSION_SECRET is missing or still the default. Auth tokens will not verify."
  );
  return "";
}

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
  const secret = getSecret();
  if (!secret) {
    throw new Error("LOCAL_SESSION_SECRET is not configured");
  }
  const mac = crypto.createHmac("sha256", secret).update(userId).digest("hex");
  return `${userId}.${mac}`;
}

export function verifyToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(userId).digest("hex");
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
