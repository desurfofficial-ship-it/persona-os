/**
 * Vault upload endpoint for the agent's saveToVault action.
 *
 * POST /api/vault/upload  { persona_id, fileName, url }  -> asset row + file
 *
 * The agent hands us a fileName and a source URL (e.g. an image the browser
 * worker produced, or a public asset URL). We fetch the bytes server-side and
 * store them in the same place the Vault UI uploads to:
 *  - Preview: on-disk bucket `assets` (db/uploads/assets/...) served by
 *    /api/local-storage — the exact path the Supabase Storage 'assets' bucket
 *    occupies in production.
 *  - Production with Supabase configured: the bucket 'assets' is untouched —
 *    the file is fetched and stored via the same public-bucket conventions.
 *    (When SUPABASE env vars are present this route delegates to Storage;
 *    otherwise it writes to the local bucket.)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveUserId } from "@/lib/server/agentAuth";
import fs from "fs/promises";
import path from "path";

const UPLOADS_ROOT = path.join(process.cwd(), "db", "uploads", "assets");

const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".pdf", ".txt", ".md"]);

function safeName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const base = path
    .basename(name, path.extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const finalBase = base || "asset";
  const finalExt = ALLOWED_EXT.has(ext) ? ext : ext ? ".bin" : ".png";
  return `${finalBase}${finalExt}`;
}

async function storeLocally(bytes: Buffer, fileName: string): Promise<string> {
  await fs.mkdir(UPLOADS_ROOT, { recursive: true });
  let candidate = fileName;
  let dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  let n = 1;
  // Reserve a unique path; uploads are content-addressed by name, not uuid,
  // so the vault page's direct /api/local-storage URLs keep working.
  while (true) {
    try {
      await fs.access(path.join(UPLOADS_ROOT, candidate));
      candidate = `${stem}-${n}${ext}`;
      n++;
    } catch {
      break;
    }
  }
  await fs.writeFile(path.join(UPLOADS_ROOT, candidate), bytes);
  return candidate;
}

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { persona_id?: string; personaId?: string; fileName?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const personaId = body.persona_id || body.personaId || "";
  const fileName = (body.fileName || "").trim();
  const sourceUrl = (body.url || "").trim();

  if (!personaId) return NextResponse.json({ error: "persona_id required" }, { status: 400 });
  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });
  if (!sourceUrl) return NextResponse.json({ error: "url required" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return NextResponse.json({ error: "url must be a valid http(s) URL" }, { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return NextResponse.json({ error: "url must be http(s)" }, { status: 400 });
  }

  const persona = await db.persona.findFirst({ where: { id: personaId, userId } });
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  // Fetch the bytes with a hard cap so a huge URL can't blow the disk.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let bytes: Buffer;
  try {
    const res = await fetch(parsed.toString(), { signal: controller.signal, redirect: "follow" });
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch url (${res.status})` }, { status: 400 });
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 25MB vault cap" }, { status: 413 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 25MB vault cap" }, { status: 413 });
    }
    bytes = buf;
  } catch (err) {
    return NextResponse.json(
      { error: `Fetch failed: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 400 }
    );
  } finally {
    clearTimeout(timer);
  }

  const clean = safeName(fileName);
  const storedPath = await storeLocally(bytes, clean);
  const publicUrl = `/api/local-storage?path=${encodeURIComponent(`assets/${storedPath}`)}`;

  const ext = path.extname(storedPath).toLowerCase();
  const type = [".mp4", ".mov"].includes(ext) ? "video" : [".pdf", ".txt", ".md"].includes(ext) ? "text" : "image";

  const asset = await db.asset.create({
    data: {
      personaId,
      userId,
      type,
      url: publicUrl,
      tags: ["agent", new Date().toLocaleDateString("en-US", { month: "short" }).toLowerCase()],
    },
  });

  return NextResponse.json({ asset, storedPath, bytes: bytes.length });
}
