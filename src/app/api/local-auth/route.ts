import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, signToken, verifyToken } from "@/lib/local-session";

/**
 * Local preview auth — email/password with salted SHA-256 hashes and
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
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
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
    return NextResponse.json({ token: signToken(user.id), user: publicUser(user) });
  }

  // ---- sign in --------------------------------------------------------------
  if (action === "signin") {
    const user = await db.localUser.findUnique({ where: { email } });
    if (!user || !verifyPassword(password, user.password)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    }
    return NextResponse.json({ token: signToken(user.id), user: publicUser(user) });
  }

  return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
}
