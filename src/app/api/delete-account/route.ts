import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import fs from "fs/promises";
import path from "path";

/**
 * Full account deletion — the "trust" promise made real. Round-3: this used
 * to wipe only assets/drafts/personas, leaving goals, goal alerts and
 * connected accounts orphaned after the user row was gone. Every
 * user-scoped table is now cleared (alerts before goals), then the user row
 * itself, then the user's upload folder on disk. Tokens are stateless HMACs,
 * so the dead account's token stops resolving the moment the user row is
 * gone.
 */

const UPLOADS_ROOT = path.join(process.cwd(), "db", "uploads");

export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Destructive op — cheap guard against a buggy client stuck in a loop.
  const rl = await rateLimit(`delete-account:${clientKey(req, userId)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    await db.goalAlert.deleteMany({ where: { userId } });
    await db.contentGoal.deleteMany({ where: { userId } });
    await db.connectedAccount.deleteMany({ where: { userId } });
    await db.asset.deleteMany({ where: { userId } });
    await db.contentDraft.deleteMany({ where: { userId } });
    await db.persona.deleteMany({ where: { userId } });
    await db.localUser.deleteMany({ where: { id: userId } });

    // Best-effort: remove uploaded files for this user.
    try {
      const dir = path.join(UPLOADS_ROOT, "assets", userId);
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("delete-account error:", err);
    return NextResponse.json({ error: "Deletion failed — try again" }, { status: 500 });
  }
}
