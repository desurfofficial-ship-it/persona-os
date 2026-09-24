/**
 * Normalize /api/generate JSON body across v1 (content) and v2 (variants[]).
 */
export function extractGenerateContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const body = data as {
    content?: unknown;
    variants?: unknown;
  };
  if (Array.isArray(body.variants) && body.variants.length > 0) {
    const first = body.variants[0] as { content?: unknown };
    if (first && typeof first.content === "string" && first.content.trim()) {
      return first.content;
    }
  }
  if (typeof body.content === "string" && body.content.trim()) {
    return body.content;
  }
  return "";
}

export function extractGenerateVariant(data: unknown): {
  content: string;
  hookType?: string;
  packaging?: { score?: number; notes?: string[] };
  flags?: string[];
} | null {
  if (!data || typeof data !== "object") return null;
  const body = data as { variants?: unknown; content?: unknown };
  if (Array.isArray(body.variants) && body.variants[0] && typeof body.variants[0] === "object") {
    const v = body.variants[0] as {
      content?: unknown;
      hookType?: string;
      packaging?: { score?: number; notes?: string[] };
      flags?: string[];
    };
    if (typeof v.content === "string" && v.content.trim()) {
      return {
        content: v.content,
        hookType: v.hookType,
        packaging: v.packaging,
        flags: v.flags,
      };
    }
  }
  if (typeof body.content === "string" && body.content.trim()) {
    return { content: body.content };
  }
  return null;
}
