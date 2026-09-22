import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
import fs from "fs/promises";
import path from "path";

/**
 * Full account deletion — the "trust" promise made real:
 * 1. delete all assets rows, 2. delete all drafts, 3. delete all personas,
 * 4. delete the user row. 5. best-effort remove the user's upload folder.
 * Tokens are stateless HMACs, so the dead account's token stops resolving
 * the moment the user row is gone.
 */

const UPLOADS_ROOT = path.join(process.cwd(), "db", "uploads");

export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
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
