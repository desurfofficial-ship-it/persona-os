import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";

/**
 * Render an image from a generated image prompt.
 * The generate page sends a persona's image_prompt result; this returns a
 * base64 PNG the client previews and can save to the Asset Vault.
 *
 * The prompt is hardened with a consistency preamble so the rendered image
 * respects the persona's visual style instead of drifting generic.
 */
export async function POST(req: NextRequest) {
  // Auth: image rendering costs real money — never an open endpoint.
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Round-3: image generation is the most expensive surface per call —
  // 20/min/user, enforced before any prompt parsing or provider spend.
  const rl = await rateLimit(`render-image:${clientKey(req, userId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
    if (prompt.length < 10) {
      return NextResponse.json({ error: "Missing or too-short prompt" }, { status: 400 });
    }
    const visualStyle =
      typeof body.visualStyle === "string" && body.visualStyle.trim()
        ? body.visualStyle.trim().slice(0, 300)
        : "";

    const full = [
      visualStyle
        ? `Visual style: ${visualStyle}. Follow it strictly.`
        : "",
      prompt,
      "Photographic, believable, shot for a personal social feed. No text overlays, no watermarks, no logos.",
    ]
      .filter(Boolean)
      .join(" ");

    const zai = await ZAI.create();
    const result = await Promise.race([
      zai.images.generations.create({ prompt: full, size: "1024x1024" }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("Image render timed out")), 120_000)
      ),
    ]);

    const base64 = (result as { data?: { base64?: string }[] })?.data?.[0]?.base64;
    if (!base64) throw new Error("Empty image result");

    return NextResponse.json({ image: `data:image/png;base64,${base64}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Image render failed";
    console.error("render-image error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
