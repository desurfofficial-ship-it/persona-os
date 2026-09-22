import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const user = await db.localUser.findUnique({ where: { email: "demo@persona-os.app" } });
  if (!user) throw new Error("demo user not found");

  const persona = await db.persona.findFirst({ where: { userId: user.id } });
  if (!persona) throw new Error("no persona for demo user");
  console.log("persona:", persona.id, persona.name);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(9, 0, 0, 0);

  // Wipe previous seed drafts for a clean slate (idempotent seed).
  await db.contentDraft.deleteMany({ where: { personaId: persona.id, content: { startsWith: "[seed]" } } });

  const drafts = [
    {
      // Contradiction pair A (diet)
      content:
        "[seed] Day 40 of going fully vegan and I am never looking back. I am vegan for life now — clearer skin, better energy, and honestly the food slaps. If you told me a year ago I'd give up steak I would have laughed.",
      type: "caption",
      posted: true,
      plannedFor: null,
      metrics: { platform: "X", views: 8400, likes: 612, comments: 48, loggedAt: new Date().toISOString() },
    },
    {
      // Contradiction pair B (diet) — posted 3 days later
      content:
        "[seed] I just destroyed a ribeye at the new steakhouse downtown. Best steak in the city, hands down. There is nothing like a perfectly seared steak after a long week.",
      type: "caption",
      posted: true,
      plannedFor: null,
      metrics: { platform: "X", views: 15200, likes: 1103, comments: 96, loggedAt: new Date().toISOString() },
    },
    {
      // Clean content for the scan (no contradiction)
      content:
        "[seed] Shipped the new onboarding flow today. Small win, but momentum compounds. Tomorrow: pricing page test.",
      type: "caption",
      posted: false,
      plannedFor: yesterday.toISOString(),
      metrics: null,
    },
  ];

  for (const d of drafts) {
    await db.contentDraft.create({
      data: {
        personaId: persona.id,
        userId: user.id,
        type: d.type,
        content: d.content,
        posted: d.posted,
        plannedFor: d.plannedFor ? new Date(d.plannedFor) : null,
        metrics: d.metrics as any,
      },
    });
  }

  const count = await db.contentDraft.count({ where: { personaId: persona.id } });
  console.log("seeded 3 drafts; persona now has", count, "drafts total");
}

main().catch(console.error).finally(() => db.$disconnect());
