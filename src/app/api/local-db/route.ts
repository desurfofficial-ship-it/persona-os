import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { userFromRequest } from "@/lib/local-session";

/**
 * Local preview DB — speaks the Postgrest subset the supabase shim emits:
 *
 *   { table, op, select, options, filters, order, limit, single, values }
 *
 * Tables map to Prisma models; columns map snake_case (client) <-> camelCase
 * (Prisma). Every operation is scoped to the token's user id — the same
 * guarantee RLS gives the real Supabase deployment.
 */

// ---------- column maps (snake_case client -> camelCase Prisma) ----------

const PERSONA_COLS: Record<string, string> = {
  id: "id",
  user_id: "userId",
  name: "name",
  backstory: "backstory",
  visual_style: "visualStyle",
  tone_of_voice: "toneOfVoice",
  lifestyle_pillars: "lifestylePillars",
  content_rules: "contentRules",
  forbidden_topics: "forbiddenTopics",
  voice_samples: "voiceSamples",
  example_posts: "examplePosts",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

const DRAFT_COLS: Record<string, string> = {
  id: "id",
  user_id: "userId",
  persona_id: "personaId",
  type: "type",
  content: "content",
  posted: "posted",
  planned_for: "plannedFor",
  metrics: "metrics",
  topic: "topic",
  auto_fill: "autoFill",
  tags: "tags",
  performance: "performance",
  created_at: "createdAt",
};

const ASSET_COLS: Record<string, string> = {
  id: "id",
  user_id: "userId",
  persona_id: "personaId",
  type: "type",
  url: "url",
  content: "content",
  tags: "tags",
  created_at: "createdAt",
};

const ACCOUNT_COLS: Record<string, string> = {
  id: "id",
  user_id: "userId",
  platform: "platform",
  handle: "handle",
  profile_url: "profileUrl",
  status: "status",
  last_synced_at: "lastSyncedAt",
  created_at: "createdAt",
};

interface TableDef {
  cols: Record<string, string>;
  hasPersonaEmbed: boolean;
}

const TABLES: Record<string, TableDef> = {
  personas: { cols: PERSONA_COLS, hasPersonaEmbed: false },
  content_drafts: { cols: DRAFT_COLS, hasPersonaEmbed: true },
  assets: { cols: ASSET_COLS, hasPersonaEmbed: true },
  connected_accounts: { cols: ACCOUNT_COLS, hasPersonaEmbed: false },
};

// ---------- helpers ----------

function mapKeys(values: Record<string, unknown>, cols: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values || {})) {
    const camel = cols[k];
    if (!camel) continue; // ignore unknown keys rather than 500ing
    out[camel] = v;
  }
  return out;
}

function mapRow(row: Record<string, unknown>, cols: Record<string, string>) {
  const out: Record<string, unknown> = {};
  const reverse: Record<string, string> = {};
  for (const [snake, camel] of Object.entries(cols)) reverse[camel] = snake;
  for (const [k, v] of Object.entries(row)) {
    out[reverse[k] || k] = v;
  }
  return out;
}

interface Filter {
  type: "eq" | "in" | "gte" | "lte" | "gt" | "lt" | "ne" | "not";
  column: string;
  value: unknown;
  innerOp?: string;
}

function buildWhere(
  filters: Filter[],
  cols: Record<string, string>,
  userId: string
): Record<string, unknown> {
  const AND: Record<string, unknown>[] = [];

  // RLS equivalent: always scope to the authenticated user.
  AND.push({ userId });

  for (const f of filters) {
    const camel = cols[f.column];
    if (!camel) throw new Error(`Unknown column "${f.column}"`);
    if (f.type === "eq") {
      AND.push({ [camel]: f.value });
    } else if (f.type === "in") {
      AND.push({ [camel]: { in: f.value } });
    } else if (f.type === "ne") {
      AND.push({ [camel]: { not: f.value } });
    } else if (f.type === "not") {
      // Postgrest negation: .not(col, op, value). Prisma's `not` accepts a
      // value (eq/ne) or a condition object (ranges / is-null).
      const inner = f.innerOp || "eq";
      if (inner === "is") {
        AND.push({ [camel]: { not: f.value } }); // not(col, "is", null) -> IS NOT NULL
      } else if (inner === "eq" || inner === "ne") {
        AND.push({ [camel]: { not: f.value } });
      } else if (inner === "gte" || inner === "lte" || inner === "gt" || inner === "lt") {
        AND.push({ [camel]: { not: { [inner]: f.value } } });
      } else {
        throw new Error(`Unsupported .not operator "${inner}"`);
      }
    } else {
      // Range comparators (gte/lte/gt/lt). DateTime columns arrive as ISO
      // strings from the browser — convert so Prisma compares properly.
      const op = f.type as "gte" | "lte" | "gt" | "lt";
      let v: unknown = f.value;
      if (typeof v === "string" && (camel === "plannedFor" || /At$/.test(camel))) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) v = d;
      }
      AND.push({ [camel]: { [op]: v } });
    }
  }

  return AND.length === 1 ? AND[0] : { AND };
}

function parseDateValue(v: unknown): Date | string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" || v instanceof Date) return v;
  return null;
}

/** Normalize values for Prisma (dates, booleans, json passthrough). */
function coerce(table: string, camel: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...camel };
  if (table === "content_drafts") {
    if ("plannedFor" in out) out.plannedFor = parseDateValue(out.plannedFor);
  }
  return out;
}

// ---------- handler ----------

export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json(
      { data: null, error: { message: "Not authenticated", status: 401 } },
      { status: 401 }
    );
  }

  let payload: {
    table?: string;
    op?: string;
    select?: string;
    options?: { count?: string; head?: boolean };
    filters?: Filter[];
    order?: { column: string; ascending: boolean };
    limit?: number;
    single?: boolean;
    values?: Record<string, unknown>;
    onConflict?: string;
  };

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: { message: "Invalid JSON" } }, { status: 400 });
  }

  const { table, op } = payload;
  const def = table ? TABLES[table] : undefined;
  if (!table || !def || !op) {
    return NextResponse.json(
      { data: null, error: { message: `Unknown table "${table}"` } },
      { status: 400 }
    );
  }

  const cols = def.cols;
  const filters = payload.filters || [];
  const selectStr = payload.select || "*";
  const wantsPersonaEmbed = def.hasPersonaEmbed && /personas\s*\(/.test(selectStr);

  // Which model delegate — Prisma client is typed per-model, so use a
  // lightweight record keyed by table name.
  const delegates: Record<string, any> = {
    personas: db.persona,
    content_drafts: db.contentDraft,
    assets: db.asset,
    connected_accounts: db.connectedAccount,
  };
  const delegate = delegates[table];

  try {
    const where = buildWhere(filters, cols, userId);

    if (op === "select") {
      const orderBy = payload.order
        ? { [cols[payload.order.column] || payload.order.column]: payload.order.ascending ? "asc" : "desc" }
        : { createdAt: "desc" as const };

      const findArgs: Record<string, unknown> = {
        where,
        orderBy,
        ...(payload.limit ? { take: payload.limit } : {}),
      };

      let rows: any[] = await delegate.findMany(findArgs);

      let count: number | undefined;
      if (payload.options?.count === "exact" && !payload.options?.head) {
        count = await delegate.count({ where });
      } else if (payload.options?.count === "exact" && payload.options?.head) {
        count = await delegate.count({ where });
        rows = [];
      }

      // Attach persona embed (name) for drafts / assets.
      let mapped = rows.map((r) => mapRow(r, cols));
      if (wantsPersonaEmbed) {
        const personaIds = Array.from(
          new Set(rows.map((r) => r.personaId).filter(Boolean))
        ) as string[];
        const personas = personaIds.length
          ? await db.persona.findMany({ where: { id: { in: personaIds }, userId } })
          : [];
        const byId = new Map(personas.map((p) => [p.id, p]));
        mapped = mapped.map((row, i) => {
          const p = byId.get(rows[i].personaId);
          const full = selectStr.includes("personas(*)");
          return {
            ...row,
            personas: p
              ? full
                ? mapRow(p as unknown as Record<string, unknown>, PERSONA_COLS)
                : { name: p.name }
              : null,
          };
        });
      }

      const data = payload.single ? mapped[0] ?? null : mapped;
      return NextResponse.json({ data, error: null, count: count ?? null });
    }

    if (op === "insert") {
      // Single row or batch (array) — both scoped to the authenticated user,
      // never trusting client-supplied user_id.
      const rawRows: Record<string, unknown>[] = Array.isArray(payload.values)
        ? payload.values
        : [payload.values || {}];
      const datas = rawRows.map((r) => {
        const d = coerce(table, mapKeys(r || {}, cols));
        d.userId = userId;
        return d;
      });

      // Upsert emulation (single row only): when the caller passes an
      // onConflict column list, look up an existing row by those columns
      // (scoped to the user) and update it instead of creating a duplicate.
      const onConflict =
        typeof payload.onConflict === "string" && payload.onConflict.trim().length > 0
          ? payload.onConflict.split(",").map((c) => c.trim()).filter(Boolean)
          : null;
      if (onConflict && onConflict.length > 0 && datas.length === 1) {
        const conflictWhere: Record<string, unknown> = { userId };
        let resolvable = true;
        for (const col of onConflict) {
          const camel = cols[col];
          const v = camel ? datas[0][camel] : undefined;
          if (!camel || v === undefined) {
            resolvable = false;
            break;
          }
          conflictWhere[camel] = v;
        }
        if (resolvable) {
          const existing = await delegate.findFirst({ where: conflictWhere });
          if (existing) {
            const updated = await delegate.update({ where: { id: (existing as { id: string }).id }, data: datas[0] });
            return NextResponse.json({ data: [mapRow(updated, cols)], error: null });
          }
        }
      }

      const createdList =
        datas.length === 1
          ? [await delegate.create({ data: datas[0] })]
          : await db.$transaction(datas.map((d) => delegate.create({ data: d })));
      const mapped = createdList.map((c) => mapRow(c, cols));
      if (wantsPersonaEmbed) {
        for (const c of createdList) {
          if ((c as { personaId?: string }).personaId) {
            const p = await db.persona.findFirst({
              where: { id: (c as { personaId: string }).personaId, userId },
            });
            if (p) {
              const hit = mapped[createdList.indexOf(c)] as { personas?: { name: string } };
              if (hit) hit.personas = { name: p.name };
            }
          }
        }
      }
      return NextResponse.json({ data: mapped, error: null });
    }

    if (op === "update") {
      const data = coerce(table, mapKeys(payload.values || {}, cols));
      const updated = await delegate.updateMany({ where, data });
      if (updated.count === 0) {
        return NextResponse.json({ data: [], error: null });
      }
      const rows: any[] = await delegate.findMany({ where });
      const mapped = rows.map((r) => mapRow(r, cols));
      return NextResponse.json({ data: mapped, error: null });
    }

    if (op === "delete") {
      const rows: any[] = await delegate.findMany({ where });
      await delegate.deleteMany({ where });
      const mapped = rows.map((r) => mapRow(r, cols));
      return NextResponse.json({ data: mapped, error: null });
    }

    return NextResponse.json(
      { data: null, error: { message: `Unknown op "${op}"` } },
      { status: 400 }
    );
  } catch (err) {
    console.error("local-db error:", err);
    const message =
      err instanceof Prisma.PrismaClientKnownRequestError
        ? `Database error (${err.code})`
        : err instanceof Error
          ? err.message
          : "Database failure";
    return NextResponse.json({ data: null, error: { message } }, { status: 500 });
  }
}
