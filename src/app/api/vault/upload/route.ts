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
 *  - Production with Supabase configured: bytes upload to Storage bucket
 *    'assets' via the service-role REST API; the assets row is written
 *    through Prisma (DATABASE_URL = Supabase Postgres).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveUserId, hasSupabase } from "@/lib/server/agentAuth";
import fs from "fs/promises";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const UPLOADS_ROOT = path.join(process.cwd(), "db", "uploads", "assets");
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB, mirrors /api/local-storage
const FETCH_TIMEOUT_MS = 30_000;

const ALLOWED_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
  ".mp4", ".mov", ".webm",
  ".pdf", ".txt", ".md", ".json",
]);

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

/** Asset type from the response mime first, extension as the fallback. */
function assetType(mime: string, fileName: string): "image" | "video" | "text" {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  const ext = path.extname(fileName).toLowerCase();
  if ([".mp4", ".mov", ".webm"].includes(ext)) return "video";
  if ([".pdf", ".txt", ".md", ".json"].includes(ext)) return "text";
  return "image";
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
  // SSRF guard: the agent only ingests from public addresses — never let it
  // point the server-side fetcher at the app itself or the private network.
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return NextResponse.json({ error: "url must be a public address" }, { status: 400 });
  }

  const persona = await db.persona.findFirst({ where: { id: personaId, userId } });
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  // Fetch the bytes with a hard cap so a huge URL can't blow the disk.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let bytes: Buffer;
  let mime = "";
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "PersonaOS-Agent/1.0 (+vault-ingest)" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Source returned ${res.status} — is the URL public?` },
        { status: 400 }
      );
    }
    mime = res.headers.get("content-type")?.split(";")[0].trim() || "";
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 25MB vault cap" }, { status: 413 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "Source returned an empty file" }, { status: 400 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 25MB vault cap" }, { status: 413 });
    }
    bytes = buf;
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timed out"
        : err instanceof Error
          ? err.message
          : "unknown";
    return NextResponse.json({ error: `Fetch failed: ${reason}`.slice(0, 200) }, { status: 400 });
  } finally {
    clearTimeout(timer);
  }

  // ---- store: Supabase Storage when configured, on-disk bucket otherwise ----
  const clean = safeName(fileName);
  let publicUrl = "";
  let storedPath = clean;
  try {
    if (hasSupabase()) {
      const objectPath = `${userId}/${Date.now()}-${clean}`;
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/assets/${objectPath}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": mime || "application/octet-stream",
          "x-upsert": "true",
        },
        body: new Uint8Array(bytes),
      });
      if (!up.ok) {
        const detail = await up.text().catch(() => "");
        console.error("[vault/upload] supabase storage error:", up.status, detail.slice(0, 200));
        return NextResponse.json({ error: `Storage upload failed (${up.status})` }, { status: 500 });
      }
      storedPath = objectPath;
      publicUrl = `${SUPABASE_URL}/storage/v1/object/public/assets/${objectPath}`;
    } else {
      storedPath = await storeLocally(bytes, clean);
      publicUrl = `/api/local-storage?path=${encodeURIComponent(`assets/${storedPath}`)}`;
    }
  } catch (err) {
    console.error("[vault/upload] store failed:", err);
    return NextResponse.json({ error: "Could not store the file" }, { status: 500 });
  }

  const asset = await db.asset.create({
    data: {
      personaId,
      userId,
      type: assetType(mime, storedPath),
      url: publicUrl,
      tags: ["agent", new Date().toLocaleDateString("en-US", { month: "short" }).toLowerCase()],
    },
  });

  return NextResponse.json({ asset, storedPath, bytes: bytes.length });
}
