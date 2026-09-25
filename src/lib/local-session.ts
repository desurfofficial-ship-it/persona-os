/**
 * Stateless signed session tokens for the local preview backend.
 *
 * Format (v2): `<userId>.<exp-seconds>.<hex hmac>` — HMAC-SHA256 over the
 * `<userId>.<exp>` payload. Tokens expire after SESSION_TTL_SEC (7 days), so
 * a leaked token is a bounded problem instead of a permanent one.
 *
 * Legacy `<userId>.<hmac(userId)>` tokens (no expiry) are REJECTED — failing
 * closed beats silently keeping non-expiring sessions alive. Users simply
 * sign in again.
 *
 * Survives server restarts without a session table.
 *
 * Production deployments should use Supabase Auth (or similar) instead of
 * these helpers. The signing secret self-heals: env var, then the generated
 * db/session-secret file, then a fresh random secret — the public default is
 * never used to sign.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Historical default — NEVER used to sign anything anymore. It exists only so
 * we can REJECT deployments that still have it configured (it is public in the
 * repo, so a token signed with it is forgeable by anyone).
 */
const DEFAULT_SECRET = "persona-os-preview-secret-do-not-use-in-prod";

/**
 * Self-healing session secret (round-3 hotfix):
 *
 *   1. LOCAL_SESSION_SECRET env var (>= 16 chars, not the public default)
 *   2. previously generated secret persisted at db/session-secret (0600)
 *   3. generate a fresh 32-byte random secret and persist it
 *
 * This removes the old failure mode where a missing .env.local made auth
 * fail closed (users could not sign in) or — worse — fall back to a
 * guessable default secret in development, which allowed session forgery.
 * The generated file lives under db/ which is gitignored, and the secret
 * survives restarts so existing sessions stay valid.
 */
const SECRET_FILE = path.join(process.cwd(), "db", "session-secret");

let cachedSecret: string | null = null;

function readPersistedSecret(): string | null {
  try {
    const fromDisk = fs.readFileSync(SECRET_FILE, "utf8").trim();
    return fromDisk.length >= 32 ? fromDisk : null;
  } catch {
    return null;
  }
}

function persistSecret(secret: string): boolean {
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, `${secret}\n`, { mode: 0o600 });
    return true;
  } catch (e) {
    console.warn(
      "[persona-os] Could not persist the generated session secret to disk:",
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

/** Resolve (and if needed create) the HMAC secret used to sign session tokens. */
export function ensureSessionSecret(): string {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.LOCAL_SESSION_SECRET?.trim();
  if (fromEnv && fromEnv !== DEFAULT_SECRET && fromEnv.length >= 16) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (fromEnv === DEFAULT_SECRET) {
    console.error(
      "[persona-os] LOCAL_SESSION_SECRET is still the PUBLIC default — refusing to sign with it."
    );
  }

  const fromDisk = readPersistedSecret();
  if (fromDisk) {
    cachedSecret = fromDisk;
    return cachedSecret;
  }

  const generated = crypto.randomBytes(32).toString("hex");
  const persisted = persistSecret(generated);
  cachedSecret = generated;
  if (persisted) {
    console.warn(
      "[persona-os] LOCAL_SESSION_SECRET not set — generated a random secret and persisted it to db/session-secret (gitignored). Sessions survive restarts; set LOCAL_SESSION_SECRET in .env.local to override."
    );
  } else {
    console.warn(
      "[persona-os] Session secret is ephemeral (could not write db/session-secret) — sessions will reset on restart."
    );
  }
  return cachedSecret;
}

function getSecret(): string {
  return ensureSessionSecret();
}

// ---- password hashing (round-3: salted SHA-256 -> scrypt) ------------------
//
// Old scheme was a single unsalted-iteration SHA-256 — fast to brute-force if
// the DB leaks. Passwords are now scrypt KDF outputs (N=16384, r=8, p=1,
// 32-byte key, 16-byte random salt per user), which are memory-hard and slow
// to attack on GPU/ASIC hardware. Legacy `salt:sha256(salt:password)` rows
// still verify (transparent upgrade path): sign-in checks them, then the
// route rehashes the password into the new format via needsRehash() — no
// forced password reset for existing users.

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_PREFIX = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`;

/** Hash a password into the persistent `scrypt$N$r$p$salt$hash` format. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${hash}`;
}

/** True if the stored hash predates scrypt and should be upgraded on next sign-in. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(SCRYPT_PREFIX);
}

/**
 * Constant-time-ish password verification. Understands both formats:
 *  - `scrypt$N$r$p$<salthex>$<hashhex>` (current)
 *  - `<salthex>:<sha256hex>` (legacy — caller should rehash after success)
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (stored.startsWith(SCRYPT_PREFIX)) {
      const [salt, hash] = stored.slice(SCRYPT_PREFIX.length).split("$");
      if (!salt || !hash) return false;
      const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      });
      const expected = Buffer.from(hash, "hex");
      return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
    }

    // Legacy salted SHA-256 (format "salt:digest").
    const salt = stored.split(":")[0];
    if (!salt) return false;
    const digest = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
    const candidate = Buffer.from(`${salt}:${digest}`);
    const storedBuf = Buffer.from(stored);
    return (
      candidate.length === storedBuf.length && crypto.timingSafeEqual(candidate, storedBuf)
    );
  } catch {
    return false;
  }
}

/** Session lifetime: 7 days from issue. */
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export function signToken(userId: string): string {
  const secret = getSecret();
  if (!secret) {
    throw new Error("LOCAL_SESSION_SECRET is not configured");
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `${userId}.${exp}`;
  const mac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

export function verifyToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;

  // v2: `<userId>.<exp>.<mac>` — parse from the right so dotted userIds survive.
  const macDot = token.lastIndexOf(".");
  if (macDot <= 0) return null;
  const payload = token.slice(0, macDot);
  const mac = token.slice(macDot + 1);

  const expDot = payload.lastIndexOf(".");
  if (expDot <= 0) return null; // legacy token without expiry -> reject
  const userId = payload.slice(0, expDot);
  const exp = Number(payload.slice(expDot + 1));
  if (!userId || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= Date.now()) return null; // expired

  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
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
