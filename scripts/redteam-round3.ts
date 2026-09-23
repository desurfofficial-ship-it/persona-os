/**
 * Red-team battery #4 — round-3 hardening verification.
 *
 *  [1] scrypt password hashing + legacy SHA-256 migration + min length 8
 *  [2] persistent rate limiter (shared SQLite store, cross-process proof)
 *  [3] rate limits on ALL remaining LLM / outbound / destructive routes
 *  [4] import-posts SSRF guard (loopback / metadata / private / IPv6)
 *  [5] storage GET strict shape + nosniff + SVG forced-download
 *  [6] delete-account wipes EVERY user-scoped table + disk files
 *
 * Run: npx tsx scripts/redteam-round3.ts
 */

import fs from "fs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

// tsx does not load .env — make sure the Prisma client can find the DB.
if (!process.env.DATABASE_URL) {
  const line = fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (line) process.env.DATABASE_URL = line.slice("DATABASE_URL=".length).trim();
}

const db = new PrismaClient();
const BASE = process.env.BASE_URL || "http://localhost:3000";

let pass = 0,
  fail = 0;
function report(id: string, ok: boolean, detail: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, headers: res.headers, text };
}

async function auth(action: "signup" | "signin", email: string, password: string) {
  const res = await fetch(`${BASE}/api/local-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, email, password }),
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  return { status: res.status, token: json.token || "", error: json.error || "" };
}

const stamp = Date.now().toString(36);
const rand = Math.random().toString(36).slice(2, 7);

/** Burst helper: send n requests, return status list. */
async function burst(n: number, make: (i: number) => Promise<number>) {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push(await make(i));
  return statuses;
}

async function main() {
  console.log(`\n=== ROUND-3 RED-TEAM BATTERY — ${BASE} ===\n`);

  // ============================================================ [1] scrypt
  console.log("--- [1] scrypt password hashing + legacy migration ---");

  const mainEmail = `rt3-main-${stamp}${rand}@test.local`;
  const mainPass = "round3-pass-123";
  const su = await auth("signup", mainEmail, mainPass);
  report("r3.s1.signup-scrypt", su.status === 200 && su.token.length > 0, `status=${su.status}`);

  const mainUser = await db.localUser.findUnique({ where: { email: mainEmail } });
  report(
    "r3.s2.stored-hash-is-scrypt",
    !!mainUser?.password.startsWith("scrypt$16384$8$1$"),
    mainUser ? `prefix=${mainUser.password.slice(0, 18)}…` : "user missing"
  );

  const short = await auth("signup", `rt3-short-${stamp}@test.local`, "short7!");
  report(
    "r3.s3.min-password-8",
    short.status === 400 && /8 characters/.test(short.error),
    `status=${short.status} err="${short.error}"`
  );

  // Legacy-format row created directly in the DB (pre-round-3 user).
  const legacyEmail = `rt3-legacy-${stamp}${rand}@test.local`;
  const legacySalt = crypto.randomBytes(8).toString("hex");
  const legacyDigest = crypto
    .createHash("sha256")
    .update(`${legacySalt}:legacy-pass-123`)
    .digest("hex");
  const legacyUser = await db.localUser.create({
    data: { email: legacyEmail, password: `${legacySalt}:${legacyDigest}` },
  });

  const legIn = await auth("signin", legacyEmail, "legacy-pass-123");
  report("r3.s4.legacy-hash-verifies", legIn.status === 200 && legIn.token.length > 0, `status=${legIn.status}`);

  const after = await db.localUser.findUnique({ where: { id: legacyUser.id } });
  report(
    "r3.s5.legacy-rehashed-on-signin",
    !!after?.password.startsWith("scrypt$16384$8$1$"),
    after ? `prefix=${after.password.slice(0, 18)}…` : "user missing"
  );

  const legIn2 = await auth("signin", legacyEmail, "legacy-pass-123");
  report("r3.s6.scrypt-rehash-signin", legIn2.status === 200, `status=${legIn2.status}`);

  const legBad = await auth("signin", legacyEmail, "wrong-pass-999");
  report("r3.s7.wrong-password-still-400", legBad.status === 400, `status=${legBad.status}`);

  // ==================================================== [2] persistent limiter
  console.log("\n--- [2] persistent rate limiter (shared SQLite store) ---");

  const limEmail = `rt3-limit-${stamp}${rand}@test.local`;
  const lim = await auth("signup", limEmail, "round3-pass-123");
  const limToken = lim.token;
  const limUser = await db.localUser.findUnique({ where: { email: limEmail } });

  const checkStatuses = await burst(21, () =>
    api("/api/check", { method: "POST", token: limToken, body: JSON.stringify({}) }).then((r) => r.status)
  );
  const first20 = checkStatuses.slice(0, 20);
  report(
    "r3.p1.check-burst-then-429",
    first20.every((s) => s !== 429) && checkStatuses[20] === 429,
    `tail=${checkStatuses.slice(-3).join(",")}`
  );

  // Cross-process proof: the dev server (process A) wrote this bucket; we
  // (process B, the battery) read the SAME row from the shared SQLite store.
  const row = await db.rateLimitBucket.findUnique({ where: { key: `check:u:${limUser?.id}` } });
  report(
    "r3.p2.bucket-persisted-in-db",
    !!row && row.count >= 21,
    row ? `count=${row.count}` : "row missing (in-memory only?)"
  );

  // ==================================================== [3] remaining routes
  console.log("\n--- [3] rate limits on remaining LLM/outbound/destructive routes ---");

  async function burstRoute(name: string, path: string, body: string, token: string, limit = 20) {
    const statuses = await burst(limit + 3, () =>
      api(path, { method: "POST", token, body }).then((r) => r.status)
    );
    const pre = statuses.slice(0, limit);
    const tail = statuses.slice(limit);
    report(
      `r3.l.${name}`,
      pre.every((s) => s !== 429) && tail.every((s) => s === 429),
      `pre-ok=${pre.filter((s) => s !== 429).length}/${limit} tail=${tail.join(",")}`
    );
  }

  await burstRoute("consistency-scan", "/api/consistency-scan", "{}", limToken);
  await burstRoute("tag-drafts", "/api/tag-drafts", "{}", limToken);
  await burstRoute("auto-tag", "/api/auto-tag", "{}", limToken);
  await burstRoute("render-image", "/api/render-image", '{"prompt":""}', limToken);
  await burstRoute("scheduled-ideas", "/api/scheduled-ideas", '{"ideaId":"nope"}', limToken);
  await burstRoute("goals-check", "/api/goals/check", "{}", limToken);

  // import-posts burst (SSRF probes below use a separate user's bucket).
  await burstRoute("import-posts", "/api/import-posts", '{"url":"no-such-host-xyz.invalid"}', limToken);

  // ============================================================ [4] SSRF
  console.log("\n--- [4] import-posts SSRF guard ---");

  const ssrfEmail = `rt3-ssrf-${stamp}${rand}@test.local`;
  const ssrf = await auth("signup", ssrfEmail, "round3-pass-123");
  const ssrfToken = ssrf.token;

  const ssrfTargets = [
    "http://127.0.0.1:3000/api/local-db",
    "http://localhost:3000/",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.1/",
    "http://10.9.8.7/",
    "http://172.16.0.9/",
    "http://[::1]:3000/",
    "https://metadata.google.internal/",
  ];
  const ssrfStatuses: number[] = [];
  for (const t of ssrfTargets) {
    const r = await api("/api/import-posts", {
      method: "POST",
      token: ssrfToken,
      body: JSON.stringify({ url: t }),
    });
    ssrfStatuses.push(r.status);
  }
  report(
    "r3.ssr1.all-internal-blocked",
    ssrfStatuses.every((s) => s === 400),
    `${ssrfTargets.length} targets -> ${ssrfStatuses.join(",")}`
  );

  const badReason = await api("/api/import-posts", {
    method: "POST",
    token: ssrfToken,
    body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }),
  });
  report(
    "r3.ssr2.guard-reason-returned",
    badReason.status === 400 && /profile URL/.test(badReason.text),
    `err="${(badReason.json as { error?: string }).error || ""}"`
  );

  // Public URL must NOT be hard-blocked (sandbox may lack egress -> 422 fallback).
  const pub = await api("/api/import-posts", {
    method: "POST",
    token: ssrfToken,
    body: JSON.stringify({ url: "https://example.com/" }),
  });
  report(
    "r3.ssr3.public-url-not-blocked",
    pub.status === 200 || pub.status === 422,
    `status=${pub.status} (422 = no egress fallback, fine)`
  );

  // ============================================================ [5] storage GET
  console.log("\n--- [5] storage GET strict shape + XSS hardening ---");

  const ssrfUser = await db.localUser.findUnique({ where: { email: ssrfEmail } });
  const uid = ssrfUser!.id;

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const upPng = await fetch(`${BASE}/api/local-storage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ssrfToken}` },
    body: (() => {
      const fd = new FormData();
      fd.append("path", `assets/${uid}/rt3.png`);
      fd.append("file", new Blob([png]), "rt3.png");
      return fd;
    })(),
  });
  report("r3.g1.upload-own-prefix", upPng.status === 200, `status=${upPng.status}`);

  const getPng = await fetch(`${BASE}/api/local-storage?path=assets/${uid}/rt3.png`);
  report(
    "r3.g2.png-inline-nosniff",
    getPng.status === 200 && getPng.headers.get("x-content-type-options") === "nosniff" && !getPng.headers.has("content-disposition"),
    `status=${getPng.status} nosniff=${getPng.headers.get("x-content-type-options")}`
  );

  const svgBody = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
  await fetch(`${BASE}/api/local-storage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ssrfToken}` },
    body: (() => {
      const fd = new FormData();
      fd.append("path", `assets/${uid}/rt3.svg`);
      fd.append("file", new Blob([svgBody], { type: "image/svg+xml" }), "rt3.svg");
      return fd;
    })(),
  });
  const getSvg = await fetch(`${BASE}/api/local-storage?path=assets/${uid}/rt3.svg`);
  report(
    "r3.g3.svg-forced-download",
    getSvg.status === 200 && /attachment/.test(getSvg.headers.get("content-disposition") || ""),
    `disposition=${getSvg.headers.get("content-disposition") || "none"}`
  );

  const probeOther = await fetch(`${BASE}/api/local-storage?path=personas/whatever.png`);
  report("r3.g4.non-asset-bucket-400", probeOther.status === 400, `status=${probeOther.status}`);

  const probeTraversal = await fetch(`${BASE}/api/local-storage?path=assets/../../../../etc/passwd`);
  report("r3.g5.traversal-shape-400", probeTraversal.status === 400, `status=${probeTraversal.status}`);

  const probeFakeUid = await fetch(
    `${BASE}/api/local-storage?path=assets/not-a-uuid/secret.png`
  );
  report("r3.g6.non-uuid-owner-400", probeFakeUid.status === 400, `status=${probeFakeUid.status}`);

  // ============================================================ [6] delete-account
  console.log("\n--- [6] delete-account wipes every user-scoped table + disk ---");

  const delEmail = `rt3-del-${stamp}${rand}@test.local`;
  const del = await auth("signup", delEmail, "round3-pass-123");
  const delUser = await db.localUser.findUnique({ where: { email: delEmail } });
  const duid = delUser!.id;

  // Seed one row in EVERY user-scoped table + a file on disk.
  const persona = await db.persona.create({
    data: { userId: duid, name: "doomed persona" },
  });
  await db.contentDraft.create({
    data: { userId: duid, personaId: persona.id, type: "post", content: "doomed draft" },
  });
  const goal = await db.contentGoal.create({
    data: { userId: duid, personaId: persona.id, title: "doomed goal", checkUrl: "https://example.com", recurrence: "daily" },
  });
  await db.goalAlert.create({
    data: { userId: duid, goalId: goal.id, title: "doomed", body: "doomed alert", dedupeKey: `rt3-${stamp}-${rand}-doomed` },
  });
  await db.connectedAccount.create({
    data: { userId: duid, platform: "x", handle: "doomed" },
  });
  await db.asset.create({
    data: { userId: duid, personaId: persona.id, type: "image", url: `assets/${duid}/doomed.txt` },
  });
  const doomedFile = `${process.cwd()}/db/uploads/assets/${duid}/doomed.txt`;
  fs.mkdirSync(`${process.cwd()}/db/uploads/assets/${duid}`, { recursive: true });
  fs.writeFileSync(doomedFile, "delete me");

  const del1 = await api("/api/delete-account", { method: "POST", token: del.token, body: "{}" });
  const counts = {
    user: await db.localUser.count({ where: { id: duid } }),
    persona: await db.persona.count({ where: { userId: duid } }),
    draft: await db.contentDraft.count({ where: { userId: duid } }),
    goal: await db.contentGoal.count({ where: { userId: duid } }),
    alert: await db.goalAlert.count({ where: { userId: duid } }),
    account: await db.connectedAccount.count({ where: { userId: duid } }),
    asset: await db.asset.count({ where: { userId: duid } }),
  };
  const fileGone = !fs.existsSync(doomedFile);
  report(
    "r3.d1.full-wipe",
    del1.status === 200 && Object.values(counts).every((c) => c === 0) && fileGone,
    `rows=${JSON.stringify(counts)} fileGone=${fileGone}`
  );

  // Limiter: 9 more idempotent calls land exactly at the 10/min cap; #11 -> 429.
  const delBurst = await burst(10, () =>
    api("/api/delete-account", { method: "POST", token: del.token, body: "{}" }).then((r) => r.status)
  );
  report(
    "r3.d2.destructive-op-capped",
    delBurst.slice(0, 9).every((s) => s === 200) && delBurst[9] === 429,
    `tail=${delBurst.slice(-3).join(",")}`
  );

  // ============================================================ summary
  console.log(`\n=== ROUND-3 RESULT: ${pass} PASS / ${fail} FAIL ===\n`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("battery crashed:", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
