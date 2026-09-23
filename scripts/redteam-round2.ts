/**
 * Round-2 red-team battery — verifies the 4 fixes on top of 6420ba6:
 *   1. Storage tenancy        (POST/DELETE must live under assets/<uid>/)
 *   2. local-auth rate limit  (10/min/IP on signup+signin)
 *   3. Session token expiry   (v2 format uid.exp.mac, 7d; legacy rejected)
 *   4. AI-route rate limits   (check / strengthen-persona / fetch-account-posts @ 20/min/user)
 *
 * Order matters: the auth burst runs LAST because it exhausts the shared
 * per-IP bucket. AI probes use empty bodies — the limiter sits before input
 * validation, so nothing here burns LLM tokens.
 *
 * Run: npx tsx scripts/redteam-round2.ts
 */
import crypto from "crypto";
import fs from "fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

// Load .env.local so the token unit tests sign with the same secret the server uses.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const SECRET = process.env.LOCAL_SESSION_SECRET || "";
function macOver(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function jsonFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function authed(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: any }> {
  return jsonFetch(path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
}

const PASSWORD = "rt2-correct-horse-battery";
async function obtainUser(tag: string): Promise<{ email: string; token: string; userId: string }> {
  const email = `rt2-${tag}-${Date.now()}@example.com`;
  let res = await jsonFetch("/api/local-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signup", email, password: PASSWORD }),
  });
  if (res.status !== 200) {
    res = await jsonFetch("/api/local-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signin", email, password: PASSWORD }),
    });
  }
  const token = res.body?.token || "";
  const userId = token.slice(0, token.indexOf("."));
  return { email, token, userId };
}

async function upload(token: string, key: string, content: string): Promise<number> {
  const form = new FormData();
  form.append("path", key);
  form.append("file", new File([content], "probe.txt", { type: "text/plain" }));
  const res = await fetch(`${BASE}/api/local-storage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
}

async function main() {
  console.log(`\n=== ROUND-2 RED-TEAM vs ${BASE} ===\n`);

  // ---------------------------------------------------------------- 1. sessions
  console.log("[1] Session tokens (exp / legacy rejection)");
  const A = await obtainUser("a");
  check("signup returns a token", Boolean(A.token));
  const segs = A.token.split(".");
  const expSec = Number(segs[1]);
  check(
    "token is v2 (uid.exp.mac) with ~7d expiry",
    segs.length === 3 && Math.abs(expSec - Date.now() / 1000 - 604800) < 300,
    `exp in ${Math.round((expSec - Date.now() / 1000) / 3600)}h`
  );

  // In-process verifyToken round-trip + forgeries (same secret as the server)
  const { verifyToken } = await import("../src/lib/local-session");
  check("verifyToken accepts a fresh v2 token", verifyToken(A.token) === A.userId);
  const legacy = `${A.userId}.${macOver(A.userId)}`;
  check("legacy token (uid.mac, no exp) rejected", verifyToken(legacy) === null);
  const expired = `${A.userId}.${Math.floor(Date.now() / 1000) - 10}.${macOver(
    `${A.userId}.${Math.floor(Date.now() / 1000) - 10}`
  )}`;
  check("expired token rejected", verifyToken(expired) === null);
  const tampered = `${A.userId}.${expSec + 999999}.${macOver(`${A.userId}.${expSec}`)}`;
  check("tampered exp rejected (mac covers exp)", verifyToken(tampered) === null);
  const getRes = await authed(legacy, "/api/local-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get", token: legacy }),
  });
  check("server rejects legacy token on /get", getRes.body?.user === null);

  // ---------------------------------------------------------- 2. storage tenancy
  console.log("\n[2] Storage tenancy (assets/<uid>/ enforcement)");
  const B = await obtainUser("b");
  check("own-prefix upload -> 200", (await upload(A.token, `assets/${A.userId}/rt2-ok.png`, "a-data")) === 200);
  const pubGet = await fetch(`${BASE}/api/local-storage?path=assets/${A.userId}/rt2-ok.png`);
  check("GET stays public (CDN-like, by design)", pubGet.status === 200);
  check("cross-user upload -> 403", (await upload(A.token, `assets/${B.userId}/rt2-steal.png`, "evil")) === 403);
  check("unprefixed upload -> 403", (await upload(A.token, "assets/rt2-shared.png", "evil")) === 403);
  check("traversal upload (../) -> 4xx", (await upload(A.token, "../rt2-escape.png", "evil")) >= 400);
  check("dot-dot within assets -> 403", (await upload(A.token, `assets/${A.userId}/../rt2-sneak.png`, "evil")) === 403);
  check("double-slash into own prefix -> 200 (harmless)", (await upload(A.token, `assets//${A.userId}/rt2-slash.png`, "a-data")) === 200);
  check("B own-prefix upload -> 200", (await upload(B.token, `assets/${B.userId}/rt2-b.png`, "b-data")) === 200);
  const delForeign = await authed(A.token, "/api/local-storage", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: [`assets/${B.userId}/rt2-b.png`] }),
  });
  check("cross-user DELETE -> 403", delForeign.status === 403);
  const delOwn = await authed(A.token, "/api/local-storage", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: [`assets/${A.userId}/rt2-ok.png`] }),
  });
  check("own DELETE -> 200", delOwn.status === 200);
  const goneGet = await fetch(`${BASE}/api/local-storage?path=assets/${A.userId}/rt2-ok.png`);
  check("deleted file really gone (404)", goneGet.status === 404);
  const unauthPost = await upload("", "assets/x/y.png", "anon");
  check("anonymous upload -> 401", unauthPost === 401);
  const unauthDel = await jsonFetch("/api/local-storage", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: ["assets/x/y.png"] }),
  });
  check("anonymous DELETE -> 401", unauthDel.status === 401);

  // ------------------------------------------------------- 3. AI-route rate limits
  console.log("\n[3] AI-route rate limits (20/min/user, limiter before validation)");
  const burst = async (token: string, path: string, n: number): Promise<number[]> => {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = await authed(token, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      statuses.push(r.status);
    }
    return statuses;
  };
  const checkStatuses = await burst(A.token, "/api/check", 25);
  check(
    "/api/check: first 20 pass validation (400), then 429s",
    checkStatuses.slice(0, 20).every((s) => s === 400) && checkStatuses.slice(20).every((s) => s === 429),
    `statuses=${checkStatuses.join(",")}`
  );
  const strengthenStatuses = await burst(B.token, "/api/strengthen-persona", 22);
  check(
    "/api/strengthen-persona: 400 x20 then 429",
    strengthenStatuses.slice(0, 20).every((s) => s === 400) &&
      strengthenStatuses.slice(20).every((s) => s === 429),
    `tail=${strengthenStatuses.slice(-3).join(",")}`
  );
  const fetchStatuses = await burst(A.token, "/api/fetch-account-posts", 22);
  check(
    "/api/fetch-account-posts: 400 x20 then 429",
    fetchStatuses.slice(0, 20).every((s) => s === 400) &&
      fetchStatuses.slice(20).every((s) => s === 429),
    `tail=${fetchStatuses.slice(-3).join(",")}`
  );

  // ------------------------------------------------------- 4. local-auth rate limit
  console.log("\n[4] local-auth rate limit (10/min/IP; 2 signups already used)");
  const authStatuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await jsonFetch("/api/local-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "signin", email: B.email, password: "wrong-password" }),
    });
    authStatuses.push(r.status);
  }
  check(
    "signin spray: first 8 -> 400 (bad creds), then 429s",
    authStatuses.slice(0, 8).every((s) => s === 400) && authStatuses.slice(8).every((s) => s === 429),
    `statuses=${authStatuses.join(",")}`
  );
  const blockedValid = await jsonFetch("/api/local-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signin", email: B.email, password: PASSWORD }),
  });
  check("even CORRECT creds blocked while rate-limited", blockedValid.status === 429);

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("battery crashed:", err);
  process.exit(1);
});
