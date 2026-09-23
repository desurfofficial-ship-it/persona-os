/**
 * Red-team battery #3 — agent workspace adversarial tests (Task 15).
 * Previous rounds (13/14) covered auth gates + UI correctness. This round:
 *   T1  SSRF via goals checkUrl (localhost / metadata IP / private range)
 *   T2  SSRF via readUrl redirect (public URL -> 302 to internal)
 *   T3  Draft flood (burst) — is there any cap?
 *   T4  Goal flood — per-user cap?
 *   T5  scheduleContent platform tag injection
 *   T6  publishAt garbage / far-future
 *   T7  Oversized chat message to /api/copilotkit
 *   T8  Unauth probes (regression: everything must 401)
 *   T9  Cross-user isolation (demo token vs breaktest draft)
 *
 * Run: npx tsx scripts/redteam-agent.ts
 */

const BASE = "http://localhost:3000";

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function signin(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/local-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signin", email, password }),
  });
  const json = (await res.json()) as { token?: string; session?: { token?: string } };
  return json.token || json.session?.token || "";
}

let pass = 0, fail = 0;
function report(id: string, ok: boolean, detail: string) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
}

async function main() {
  const demo = await signin("demo@persona-os.app", "preview123");
  console.log(`demo token: ${demo ? "ok" : "MISSING"} (len ${demo.length})`);
  if (!demo) process.exit(1);

  // persona for demo user
  const pres = await api("/api/personas", { token: demo });
  const personas = (pres.json.data || pres.json.personas) as Array<{ id: string; name: string }> | undefined;
  const personaId = personas?.[0]?.id || "";
  console.log(`persona: ${personas?.[0]?.name} (${personaId.slice(0, 8)}…)`);

  // ---------------------------------------------------------------- T1 SSRF
  console.log("\n--- T1: SSRF via goals checkUrl ---");
  const ssrfTargets = [
    ["loopback", "http://localhost:3000/api/local-auth"],
    ["metadata-ip", "http://169.254.169.254/latest/meta-data/"],
    ["private-range", "http://192.168.1.1/admin"],
    ["local-ip", "http://127.0.0.1:3000/api/personas"],
  ];
  for (const [label, url] of ssrfTargets) {
    const r = await api("/api/goals", {
      method: "POST", token: demo,
      body: JSON.stringify({ goalTitle: `RT probe ${label}`, recurrence: "weekly", checkUrl: url, persona_id: personaId }),
    });
    report(`T1.${label}`, r.status === 400 || r.status === 422, `status=${r.status} ${JSON.stringify(r.json).slice(0, 90)}`);
    if (r.status === 201 || r.status === 200) {
      // cleanup the bad goal immediately
      const goalId = ((r.json.goal as { id?: string })?.id) || "";
      if (goalId) await api(`/api/goals?id=${goalId}`, { method: "DELETE", token: demo });
    }
  }

  // ------------------------------------------------- T2 draft flood (burst)
  console.log("\n--- T2: draft flood 50x (2KB each — tests burst, not size cap) ---");
  const small = "x".repeat(2_000);
  const t0 = Date.now();
  let floodOk = 0, flood429 = 0;
  for (let i = 0; i < 50; i++) {
    const r = await api("/api/drafts", {
      method: "POST", token: demo,
      body: JSON.stringify({ persona_id: personaId, type: "caption", content: `flood ${i} ${small}` }),
    });
    if (r.status === 201 || r.status === 200) floodOk++;
    if (r.status === 429) flood429++;
  }
  console.log(`  50 x 2KB drafts in ${Date.now() - t0}ms: accepted=${floodOk} rate-limited=${flood429}`);
  report("T2.flood-capped", flood429 > 0, flood429 > 0 ? "server pushed back with 429" : `NO CAP — all ${floodOk} accepted`);

  // ------------------------------------------------- T3 goal flood
  console.log("\n--- T3: goal flood ---");
  let goalCount = 0;
  const created: string[] = [];
  for (let i = 0; i < 25; i++) {
    const r = await api("/api/goals", {
      method: "POST", token: demo,
      body: JSON.stringify({ goalTitle: `RT flood goal ${i}`, recurrence: "weekly", checkUrl: `https://example.com/rt-${i}`, persona_id: personaId }),
    });
    if (r.status === 200 || r.status === 201) {
      goalCount++;
      const id = ((r.json.goal as { id?: string })?.id) || "";
      if (id) created.push(id);
    }
  }
  report("T3.goal-capped", goalCount < 25, `accepted=${goalCount}/25`);

  // ------------------------------------- T4 platform tag injection via PATCH
  console.log("\n--- T4: scheduleContent platform injection ---");
  const dr = await api("/api/drafts", {
    method: "POST", token: demo,
    body: JSON.stringify({ persona_id: personaId, type: "caption", content: "RT injection target draft" }),
  });
  let draftId = ((dr.json.draft as { id?: string })?.id) || "";
  if (!draftId) {
    // Burst budget spent by the flood above — reuse a flood draft (never a real one).
    const list = await api("/api/drafts", { token: demo });
    const drafts = (list.json.drafts as Array<{ id: string; content?: string }>) || [];
    const floodDraft = drafts.find((d) => (d.content || "").startsWith("flood"));
    draftId = floodDraft?.id || "";
    console.log(`  (burst cap active — using flood draft ${draftId.slice(0, 8)}… for T4/T8)`);
  }
  const pr = await api("/api/drafts", {
    method: "PATCH", token: demo,
    body: JSON.stringify({ id: draftId, publishAt: new Date(Date.now() + 864e5).toISOString(), platform: "<script>alert(1)</script>" }),
  });
  const tags = ((pr.json.draft as { tags?: string[] })?.tags) || [];
  const badTag = tags.find((t) => t.includes("<") || t.includes(">") || t.includes("("));
  report("T4.platform-allowlist", !badTag, badTag ? `injected tag stored: "${badTag}"` : `tags=${JSON.stringify(tags)}`);

  // --------------------------------------------- T5 publishAt garbage values
  console.log("\n--- T5: publishAt validation ---");
  const g1 = await api("/api/drafts", { method: "PATCH", token: demo, body: JSON.stringify({ id: draftId, publishAt: "not-a-date" }) });
  report("T5.garbage-date-400", g1.status === 400, `status=${g1.status}`);
  const g2 = await api("/api/drafts", { method: "PATCH", token: demo, body: JSON.stringify({ id: draftId, publishAt: "0001-01-01T00:00:00Z" }) });
  report("T5.absurd-past", g2.status === 400 || g2.status === 200, `status=${g2.status} (accepted is tolerable, calendar must render)`);

  // ------------------------------------- T6 oversized chat message to runtime
  console.log("\n--- T6: oversized /api/copilotkit message ---");
  const huge = "A".repeat(200_000);
  const t6 = await api("/api/copilotkit", {
    method: "POST", token: demo,
    headers: { "x-persona-id": personaId },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", content: `${huge}\n[Model:anthropic/claude-3-5-haiku][Type:caption][Persona:${personaId}]` }],
    }),
  });
  report("T6.oversize-handled", t6.status === 413 || (t6.status >= 400 && t6.status < 500), `status=${t6.status} (500 would be bad)`);

  // --------------------------------------------- T7 unauth probe regression
  console.log("\n--- T7: unauth probes must 401 ---");
  const probes: Array<[string, RequestInit]> = [
    ["/api/copilotkit", { method: "POST", body: JSON.stringify({ messages: [] }) }],
    ["/api/drafts", { method: "POST", body: JSON.stringify({ persona_id: "x", content: "x" }) }],
    ["/api/drafts", { method: "PATCH", body: JSON.stringify({ id: "x" }) }],
    ["/api/goals", { method: "POST", body: JSON.stringify({ goalTitle: "x", checkUrl: "https://x.com", persona_id: "x" }) }],
    ["/api/goals/check", { method: "POST", body: JSON.stringify({}) }],
    ["/api/local-storage?path=assets/rt-probe.txt", { method: "POST" }],
    ["/api/personas", { method: "GET" }],
    ["/api/generate", { method: "POST", body: JSON.stringify({}) }],
  ];
  for (const [p, init] of probes) {
    const r = await api(p, init);
    report(`T7.${p}?${init.method}`, r.status === 401, `status=${r.status}`);
  }

  // ------------------------------------------------ T8 cross-user isolation
  console.log("\n--- T8: cross-user isolation ---");
  const attackerEmail = `rt-attacker-${Date.now()}@persona-os.app`;
  const su = await api("/api/local-auth", { method: "POST", body: JSON.stringify({ action: "signup", email: attackerEmail, password: "rt-attacker-pass-1" }) });
  console.log(`  attacker signup: ${su.status} body=${JSON.stringify(su.json).slice(0, 120)}`);
  const si = await api("/api/local-auth", { method: "POST", body: JSON.stringify({ action: "signin", email: attackerEmail, password: "rt-attacker-pass-1" }) });
  console.log(`  attacker signin: ${si.status} body=${JSON.stringify(si.json).slice(0, 120)}`);
  const bt2 = (su.json.token as string) || (si.json.token as string) || "";
  if (bt2 && draftId) {
    const hijack = await api("/api/drafts", { method: "PATCH", token: bt2, body: JSON.stringify({ id: draftId, publishAt: "2026-01-01T00:00:00Z" }) });
    report("T8.draft-hijack-blocked", hijack.status === 404, `status=${hijack.status} (foreign draft must 404)`);
    const goalHijack = await api("/api/goals", { method: "PATCH", token: bt2, body: JSON.stringify({ id: created[0] || "nonexistent", status: "paused" }) });
    report("T8.goal-hijack-blocked", goalHijack.status === 404 || !created.length, `status=${goalHijack.status}`);
  } else {
    report("T8.draft-hijack-blocked", false, "attacker account unavailable");
  }

  // ----------------------------------------------------------- cleanup
  console.log("\n--- cleanup ---");
  for (const id of created) await api(`/api/goals?id=${id}`, { method: "DELETE", token: demo });
  console.log(`removed ${created.length} flood goals`);

  console.log(`\n==== REDTEAM3 RESULT: ${pass} PASS / ${fail} FAIL ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("battery crashed:", e); process.exit(2); });
