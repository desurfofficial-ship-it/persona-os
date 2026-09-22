import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const personaId = process.argv[2];
async function main() {
  const drafts = await db.contentDraft.findMany({
    where: { personaId },
    select: { type: true, posted: true, content: true },
  });
  for (const d of drafts) {
    console.log(`[${d.type} | posted=${d.posted}] ${d.content.slice(0, 120).replace(/\n/g, " ")}`);
  }
  await db.$disconnect();
}
main();
