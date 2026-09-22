/**
 * Server-side auth + persona loading for the agent routes
 * (/api/copilotkit, /api/goals, /api/drafts, /api/vault/upload, /api/personas).
 *
 * Dual-mode, mirroring the rest of Persona OS:
 *  - Real Supabase deployment (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *    set): the Bearer token is a Supabase Auth access token, verified via
 *    GoTrue; personas load over PostgREST with the service role key.
 *  - Preview backend (default in this sandbox): the Bearer token is the local
 *    HMAC session token; personas load from Prisma.
 *
 * The response shape is identical in both modes so callers never branch.
 */

import { db } from "@/lib/db";
import { verifyToken } from "@/lib/local-session";

export interface AgentPersona {
  id: string;
  userId: string;
  name: string;
  backstory: string;
  tone: string;
  lifestylePillars: string[];
  contentRules: string[];
  forbiddenTopics: string[];
  visualStyle: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function hasSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function supabaseUserId(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user.id || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the calling user. Supabase first (when configured), local HMAC
 * session otherwise. Returns null for anonymous callers — agent routes are
 * never public.
 */
export async function resolveUserId(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;

  if (hasSupabase()) {
    const supabaseUser = await supabaseUserId(token);
    if (supabaseUser) return supabaseUser;
    // Fall through: the caller might still hold a preview token (migration window).
  }
  return verifyToken(token);
}

interface RawPersonaRow {
  id: string;
  user_id: string;
  name: string;
  backstory?: string | null;
  tone_of_voice?: string | null;
  lifestyle_pillars?: string[] | null;
  content_rules?: string[] | null;
  forbidden_topics?: string[] | null;
  visual_style?: string | null;
  // Preview/Prisma shapes (camelCase) tolerate the same endpoint.
  toneOfVoice?: string | null;
  lifestylePillars?: string[] | null;
  contentRules?: string[] | null;
  forbiddenTopics?: string[] | null;
  visualStyle?: string | null;
  userId?: string;
}

function normalizePersona(row: RawPersonaRow): AgentPersona {
  const toStringArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (typeof value === "string" && value.trim().length > 0) {
      return value
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
        .filter(Boolean);
    }
    return [];
  };
  return {
    id: row.id,
    userId: row.user_id || row.userId || "",
    name: row.name || "Unnamed persona",
    backstory: row.backstory || "",
    tone: row.tone_of_voice || row.toneOfVoice || "",
    lifestylePillars: toStringArray(row.lifestyle_pillars ?? row.lifestylePillars),
    contentRules: toStringArray(row.content_rules ?? row.contentRules),
    forbiddenTopics: toStringArray(row.forbidden_topics ?? row.forbiddenTopics),
    visualStyle: row.visual_style || row.visualStyle || "",
  };
}

/** Load one persona by id, strictly scoped to the caller. */
export async function loadPersonaScoped(req: Request, personaId: string): Promise<AgentPersona | null> {
  // Resolve the caller first — no identity, no persona, in every mode.
  const userId = await resolveUserId(req);
  if (!userId || !personaId) return null;

  if (hasSupabase()) {
    try {
      const url =
        `${SUPABASE_URL}/rest/v1/personas?id=eq.${encodeURIComponent(personaId)}` +
        `&user_id=eq.${encodeURIComponent(userId)}` +
        `&select=id,user_id,name,backstory,tone_of_voice,lifestyle_pillars,content_rules,forbidden_topics,visual_style&limit=1`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });
      if (res.ok) {
        const rows = (await res.json()) as RawPersonaRow[];
        const row = rows[0];
        if (row) {
          // user_id is in the WHERE above; this check is defense-in-depth.
          if (row.user_id && row.user_id !== userId) return null;
          return normalizePersona(row);
        }
        return null;
      }
    } catch (err) {
      console.error("[agentAuth] Supabase persona load failed, using Prisma:", err);
    }
  }

  const row = await db.persona.findFirst({ where: { id: personaId, userId } });
  if (!row) return null;
  return normalizePersona(row as unknown as RawPersonaRow);
}

/** List the caller's personas (newest first) — used by /api/personas. */
export async function listPersonasScoped(req: Request): Promise<AgentPersona[]> {
  const userId = await resolveUserId(req);
  if (!userId) return [];

  if (hasSupabase()) {
    try {
      const url =
        `${SUPABASE_URL}/rest/v1/personas` +
        `?user_id=eq.${encodeURIComponent(userId)}` +
        `&select=id,user_id,name,backstory,tone_of_voice,lifestyle_pillars,content_rules,forbidden_topics,visual_style&order=created_at.desc`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      });
      if (res.ok) {
        const rows = (await res.json()) as RawPersonaRow[];
        return rows.map(normalizePersona);
      }
    } catch (err) {
      console.error("[agentAuth] Supabase persona list failed, using Prisma:", err);
    }
  }

  const rows = await db.persona.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => normalizePersona(row as unknown as RawPersonaRow));
}
