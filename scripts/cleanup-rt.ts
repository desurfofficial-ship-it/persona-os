import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const del = await db.contentDraft.deleteMany({ where: { content: { startsWith: "flood " } } });
  console.log(`deleted ${del.count} flood drafts`);
  const users = await db.localUser.findMany({ where: { email: { contains: "rt-attacker" } }, select: { id: true, email: true } });
  for (const u of users) {
    await db.contentDraft.deleteMany({ where: { userId: u.id } });
    await db.localUser.delete({ where: { id: u.id } });
  }
  console.log(`removed ${users.length} attacker accounts`);
  const probe = await db.localUser.findMany({ where: { email: { contains: "probe-shape" } } });
  for (const u of probe) await db.localUser.delete({ where: { id: u.id } });
  console.log(`removed ${probe.length} probe accounts`);
}
main().finally(() => db.$disconnect());
