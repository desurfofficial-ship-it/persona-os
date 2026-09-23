import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import fs from "fs/promises";
import path from "path";

/**
 * Auto-tag a vault asset. For images we try the vision model to read what's
 * actually in the frame; anything that fails degrades to honest heuristic
 * tags (type, month, persona) rather than pretending.
 */

const UPLOADS_ROOT = path.join(process.cwd(), "db", "uploads");

function heuristicTags(type: string, personaName: string | null): string[] {
  const month = new Date().toLocaleDateString("en-US", { month: "short" });
  const tags = [type, `uploaded ${month}`];
  if (personaName) tags.push(personaName.toLowerCase());
  return tags;
}

/** Mood/location quick tags offered by the vault UI — keeps vocab consistent. */
export const QUICK_TAGS = [
  "luxury", "casual", "professional", "night", "beach", "office", "gym", "travel",
];

export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Round-3: LLM route — 20/min/user, enforced before any validation/LLM spend.
  const rl = await rateLimit(`auto-tag:${clientKey(req, userId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let assetId = "";
  try {
    ({ assetId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!assetId) {
    return NextResponse.json({ error: "assetId required" }, { status: 400 });
  }

  const asset = await db.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  let personaName: string | null = null;
  if (asset.personaId) {
    const persona = await db.persona.findFirst({ where: { id: asset.personaId, userId } });
    personaName = persona?.name ?? null;
  }

  // Try vision description for images.
  if (asset.type === "image" && asset.url) {
    const rel = asset.url.split("path=")[1];
    if (rel) {
      const relPath = decodeURIComponent(rel);
      const full = path.resolve(UPLOADS_ROOT, relPath);
      if (full.startsWith(UPLOADS_ROOT)) {
        try {
          const buf = await fs.readFile(full);
          const b64 = buf.toString("base64");
          const dataUrl = `data:image/${path.extname(full).slice(1) || "png"};base64,${b64}`;

          const zai = await ZAI.create();
          const completion = await zai.chat.completions.createVision({
            model: "glm-4.5v",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Describe this image for a content asset vault in 5-8 lowercase keyword tags. Include: what's in the frame, the MOOD (e.g. luxury, casual, gritty, cozy), and the LOCATION/SETTING when evident (e.g. office, beach, car, gym, city night). Reply with ONLY the tags separated by commas — no other words.",
                  },
                  { type: "image_url", image_url: { url: dataUrl } },
                ],
              },
            ],
            thinking: { type: "disabled" },
          });

          const content: string = completion.choices?.[0]?.message?.content || "";
          const tags = content
            .split(/[,\n]/)
            .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 \-]/g, "").trim())
            .filter((t) => t.length > 1 && t.length < 30)
            .slice(0, 8);

          if (tags.length > 0) {
            const all = Array.from(new Set([...tags]));
            await db.asset.update({ where: { id: asset.id }, data: { tags: all } });
            return NextResponse.json({ tags: all, source: "vision" });
          }
        } catch (err) {
          console.error("auto-tag vision failed, using heuristics:", err);
        }
      }
    }
  }

  // Heuristic fallback for images whose vision failed, and for videos.
  const tags = heuristicTags(asset.type, personaName);
  await db.asset.update({ where: { id: asset.id }, data: { tags } });
  return NextResponse.json({ tags, source: "heuristic" });
}
