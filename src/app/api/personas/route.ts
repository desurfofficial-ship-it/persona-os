/**
 * GET /api/personas — list the caller's personas for the agent UI
 * (persona selector on /dashboard/generate). Uses the shared dual-mode
 * loader: Supabase PostgREST when configured, preview DB otherwise.
 */

import { NextRequest, NextResponse } from "next/server";
import { listPersonasScoped } from "@/lib/server/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personas = await listPersonasScoped(req);
  return NextResponse.json({ personas });
}
