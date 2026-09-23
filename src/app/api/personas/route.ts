/**
 * GET /api/personas — list the caller's personas for the agent UI
 * (persona selector on /dashboard/generate). Uses the shared dual-mode
 * loader: Supabase PostgREST when configured, preview DB otherwise.
 */

import { NextRequest, NextResponse } from "next/server";
import { listPersonasScoped, resolveUserId } from "@/lib/server/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Same contract as every other agent route: anonymous callers get 401,
  // never an (empty) data shape.
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const personas = await listPersonasScoped(req);
  return NextResponse.json({ personas });
}
