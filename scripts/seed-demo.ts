/**
 * Seed the demo account + one persona so redteam-agent.ts has fixtures.
 * The demo user itself is created via signup (hashed password) — this script
 * only ensures a persona exists for it.
 * Idempotent. Run: npx tsx scripts/seed-demo.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const user = await db.localUser.findUnique({ where: { email: "demo@persona-os.app" } });
  if (!user) {
    console.error("demo user not found — sign up demo@persona-os.app first");
    process.exit(1);
  }

  const existing = await db.persona.findFirst({ where: { userId: user.id } });
  if (existing) {
    console.log(`persona exists: ${existing.id} (${existing.name})`);
    return;
  }

  const persona = await db.persona.create({
    data: {
      userId: user.id,
      name: "The Disciplined Founder",
      backstory:
        "Ex-agency operator who rebuilt his career around systems, deep work, and radical consistency. Writes about the unglamorous side of building companies.",
      toneOfVoice: "Direct, dry humor, zero fluff. Short punchy sentences.",
      lifestylePillars: ["Deep work", "Systems over goals", "Health as leverage", "Honest builds in public"],
      contentRules: [
        "Lead with a concrete lesson, never a platitude",
        "One idea per post",
        "No engagement-bait questions",
        "Always end with something actionable",
      ],
      forbiddenTopics: ["politics", "crypto hype", "get-rich-quick"],
    },
  });
  console.log(`persona created: ${persona.id} (${persona.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
