import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, needsRehash, signToken, verifyToken } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";

/**
 * Local preview auth — email/password with scrypt-hashed passwords
 * (legacy SHA-256 rows transparently rehashed on sign-in) and
 * stateless HMAC session tokens (src/lib/local-session.ts).
 *
 * Speaks the exact protocol the supabase shim (src/lib/supabase.ts) emits:
 *
 *   POST { action: "get",    token }            -> { user } | { user: null }
 *   POST { action: "signup", email, password }  -> { token, user } | { error }
 *   POST { action: "signin", email, password }  -> { token, user } | { error }
 *
 * Preview-only: a real deployment uses Supabase Auth (GoTrue) and never
 * mounts this surface.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u: { id: string; email: string }) {
  return { id: u.id, email: u.email };
}

export async function POST(req: NextRequest) {
  let body: { action?: string; token?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action || "";

  // Brute-force / signup-flood protection: 10 credential attempts per minute
  // per IP (password spray on known emails, signup flood filling SQLite).
  // Session lookup ("get") is exempt — it verifies a token, no password path.
  if (action === "signup" || action === "signin") {
    const rl = await rateLimit(`auth:${clientKey(req)}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many attempts. Retry in ${rl.retryAfterSec}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSec) },
        }
      );
    }
  }

  // ---- session lookup -------------------------------------------------------
  if (action === "get") {
    const userId = verifyToken(body.token);
    if (!userId) return NextResponse.json({ user: null });
    const user = await db.localUser.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ user: null });
    return NextResponse.json({ user: publicUser(user) });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  // ---- sign up --------------------------------------------------------------
  if (action === "signup") {
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const existing = await db.localUser.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "This email is already registered — sign in instead" },
        { status: 400 }
      );
    }
    const user = await db.localUser.create({
      data: { email, password: hashPassword(password) },
    });
    try {
      const token = signToken(user.id);
      return NextResponse.json({ token, user: publicUser(user) });
    } catch (e) {
      console.error("signup token:", e);
      return NextResponse.json(
        {
          error:
            "Account created but session could not be created. Set LOCAL_SESSION_SECRET (≥16 chars) in .env.local and restart, then sign in.",
        },
        { status: 500 }
      );
    }
  }

  // ---- sign in --------------------------------------------------------------
  if (action === "signin") {
    const user = await db.localUser.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.password)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    }
    // Transparent upgrade: pre-round-3 salted-SHA-256 rows get rehashed into
    // scrypt on the first successful sign-in (no forced password reset).
    if (needsRehash(user.password)) {
      await db.localUser
        .update({ where: { id: user.id }, data: { password: hashPassword(password) } })
        .catch(() => {}); // best-effort; verification already succeeded
    }
    try {
      const token = signToken(user.id);
      return NextResponse.json({ token, user: publicUser(user) });
    } catch (e) {
      console.error("signin token:", e);
      return NextResponse.json(
        {
          error:
            "Password ok but session could not be created. Set LOCAL_SESSION_SECRET (≥16 chars) in .env.local and restart the server.",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
