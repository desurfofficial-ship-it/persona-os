/**
 * One-off hygiene: strip injected/dirty tags (script probes, '#' prefixes)
 * from ContentDraft.tags. Part of the Task 16 hardening pass.
 */
import { db } from "../src/lib/db";

async function main() {
  const drafts = await db.contentDraft.findMany({ select: { id: true, tags: true } });
  let cleaned = 0;
  for (const d of drafts) {
    const tags = (d.tags as unknown as unknown[]) || [];
    const safe = tags.filter(
      (t) => typeof t === "string" && !/[<>"']|script|alert/i.test(t) && !t.startsWith("#")
    );
    if (safe.length !== tags.length) {
      await db.contentDraft.update({ where: { id: d.id }, data: { tags: safe } });
      cleaned++;
    }
  }
  console.log("cleaned drafts:", cleaned);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
