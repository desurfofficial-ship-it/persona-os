/**
 * SSRF guard — shared by /api/goals (goal creation) and the browser worker
 * (readUrl). A goal's check_url is a server-side fetch target, so without
 * this guard any signed-in user can point Persona OS at loopback / private
 * network / cloud-metadata addresses and read the responses back through
 * goal alerts (classic SSRF -> credential exfil chain).
 *
 * Rules:
 *  - http/https only (no file:, gopher:, data:…)
 *  - hostname must not be a loopback/local alias (localhost, *.local, …)
 *  - EVERY resolved address must be globally routable:
 *      no 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local
 *      incl. cloud metadata), 172.16/12, 192.168/16, 198.18/15, 224/4,
 *      240/4, ::1, fe80::/10, fc00::/7, ::ffff:-mapped v4 of any of those.
 *
 * DNS is re-resolved per call (no TOCTOU cache) and callers should re-apply
 * the guard to every redirect hop (see readUrl's manual redirect loop).
 */

import dns from "dns";
import net from "net";

const LOCAL_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa", ".lan", ".intranet"];

export interface SafeUrlResult {
  ok: boolean;
  reason?: string;
}

function ipv4ToLong(ip: string): number {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return -1;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const v = ipv4ToLong(ip);
  const b = ipv4ToLong(base);
  if (v < 0 || b < 0) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v & mask) === (b & mask);
}

/** True if the address must never be fetched from the server. */
export function isForbiddenIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    return (
      inCidr4(ip, "0.0.0.0", 8) || // this-network
      inCidr4(ip, "10.0.0.0", 8) || // private
      inCidr4(ip, "100.64.0.0", 10) || // CGNAT
      inCidr4(ip, "127.0.0.0", 8) || // loopback
      inCidr4(ip, "169.254.0.0", 16) || // link-local (incl. 169.254.169.254 metadata)
      inCidr4(ip, "172.16.0.0", 12) || // private
      inCidr4(ip, "192.0.0.0", 24) || // IETF protocol assignments
      inCidr4(ip, "192.168.0.0", 16) || // private
      inCidr4(ip, "198.18.0.0", 15) || // benchmarking
      inCidr4(ip, "224.0.0.0", 4) || // multicast
      inCidr4(ip, "240.0.0.0", 4) // reserved
    );
  }
  if (kind === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) — judge the embedded v4 address.
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isForbiddenIp(mapped[1]);
    const bare = ip.toLowerCase();
    if (bare === "::" || bare === "::1") return true;
    if (bare.startsWith("fe8") || bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")) return true; // link-local
    if (/^f[cd]/.test(bare)) return true; // unique local fc00::/7
    if (bare.startsWith("ff")) return true; // multicast
    return false;
  }
  return true; // unparseable -> treat as forbidden
}

/**
 * Validate a URL for server-side fetching. Returns ok:false with a
 * human-readable reason the caller can surface verbatim.
 */
export async function assertPublicHttpUrl(raw: string): Promise<SafeUrlResult> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "checkUrl must be a valid URL" };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { ok: false, reason: "checkUrl must be http(s)" };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "checkUrl has no host" };
  if (host === "localhost" || host.endsWith(".localhost") || LOCAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "checkUrl cannot point at a local/internal host" };
  }

  // Metadata-style literal hostnames some resolvers answer on.
  if (host === "metadata.google.internal" || host === "instance-data") {
    return { ok: false, reason: "checkUrl cannot point at a metadata service" };
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    return { ok: false, reason: `checkUrl host could not be resolved: ${host}` };
  }
  if (!addresses.length) {
    return { ok: false, reason: `checkUrl host resolved to no addresses: ${host}` };
  }
  for (const a of addresses) {
    if (isForbiddenIp(a.address)) {
      return { ok: false, reason: "checkUrl resolves to a private/protected network address" };
    }
  }
  return { ok: true };
}
