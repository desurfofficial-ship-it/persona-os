import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { userFromRequest } from "@/lib/local-session";

/**
 * Local preview storage — on-disk bucket storage backing the supabase shim's
 * `supabase.storage.from(bucket)` surface (src/lib/supabase.ts).
 *
 *   POST   multipart { path: "<bucket>/<...>", file } -> { error: null }
 *   GET    ?path=<bucket>/<...>                        -> file bytes
 *   DELETE { paths: ["<bucket>/<...>", ...] }          -> { data: { removed } }
 *
 * Files live under db/uploads/<bucket>/<...>. Every path is resolved and
 * required to stay inside that root (no traversal).
 *
 * Tenancy (write paths): POST and DELETE only operate inside the caller's
 * own `assets/<userId>/` prefix — "logged in" alone would let any user
 * overwrite or wipe another user's files (paths are guessable and appear
 * in draft/vault URLs).
 *
 * GET stays public by design: stored assets are CDN-like (posted images),
 * and <img> tags cannot attach Authorization headers. Anything sensitive
 * does not belong in this bucket.
 */

const UPLOAD_ROOT = path.join(process.cwd(), "db", "uploads");
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json",
};

/** Resolve a "bucket/sub/path" key to an absolute path inside UPLOAD_ROOT, or null. */
function safeResolve(key: string): string | null {
  if (!key) return null;
  const normalized = path.normalize(key).replace(/^([/\\])+/, "");
  const abs = path.resolve(UPLOAD_ROOT, normalized);
  if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return abs;
}

/**
 * Tenant check: after normalization the key must live under the caller's own
 * `assets/<userId>/` prefix. Normalizing first means `assets//<uid>/x` still
 * passes (same file, same owner), while `assets/<other-uid>/x`, unprefixed
 * keys and `..` escapes are all rejected.
 */
function belongsToUser(userId: string, key: string): boolean {
  const normalized = path.normalize(key).replace(/^([/\\])+/, "");
  return (
    normalized.startsWith(`assets/${userId}/`) ||
    normalized.startsWith(`assets${path.sep}${userId}${path.sep}`)
  );
}

function contentTypeFor(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] || "application/octet-stream";
}

// ---- GET: serve a stored object (public URLs point here) --------------------
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("path") || "";
  const abs = safeResolve(key);
  if (!abs) return NextResponse.json({ error: "Bad path" }, { status: 400 });

  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error("not a file");
    const data = await fs.readFile(abs);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentTypeFor(abs),
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// ---- POST: upload (auth-gated — an open upload endpoint is an arbitrary-
// file-write + storage-DoS surface; DELETE was already gated, POST was not) ---
export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const key = String(form.get("path") || "");
  const file = form.get("file");
  const abs = safeResolve(key);
  if (!abs || !key.trim()) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
  if (!belongsToUser(userId, key)) {
    return NextResponse.json(
      { error: "Forbidden — uploads must live under assets/<your-user-id>/" },
      { status: 403 }
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (25 MB max)" }, { status: 413 });
  }

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ error: null, path: key, bytes: file.size });
  } catch (err) {
    console.error("local-storage upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

// ---- DELETE: remove objects (auth-gated) --------------------------------------
export async function DELETE(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];

  // All-or-nothing tenancy: one foreign path rejects the whole batch, so a
  // caller can never learn whether another user's file exists via DELETE.
  if (paths.some((p) => !belongsToUser(userId, p))) {
    return NextResponse.json(
      { error: "Forbidden — deletes must target assets/<your-user-id>/" },
      { status: 403 }
    );
  }

  const removed: string[] = [];

  for (const key of paths) {
    const abs = safeResolve(key);
    if (!abs) continue;
    try {
      await fs.unlink(abs);
      removed.push(key);
      // Prune now-empty user folders so the bucket stays tidy.
      let dir = path.dirname(abs);
      while (dir.startsWith(UPLOAD_ROOT) && dir !== UPLOAD_ROOT) {
        const entries = await fs.readdir(dir).catch(() => null);
        if (entries === null || entries.length > 0) break;
        await fs.rmdir(dir).catch(() => {});
        dir = path.dirname(dir);
      }
    } catch {
      // Missing files count as removed (idempotent, like Supabase).
      removed.push(key);
    }
  }

  return NextResponse.json({ data: { removed } });
}
