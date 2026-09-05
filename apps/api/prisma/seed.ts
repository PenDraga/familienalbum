// Legt den ersten globalen Admin an (idempotent). Aufruf: `npx prisma db seed`
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME ?? 'Admin';

  if (!email || !password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD nicht gesetzt – kein Admin angelegt.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.isAdmin) {
      await prisma.user.update({ where: { id: existing.id }, data: { isAdmin: true } });
      console.log(`Benutzer ${email} zum Admin gemacht.`);
    } else {
      console.log(`Admin ${email} existiert bereits.`);
    }
    return;
  }

  await prisma.user.create({
    data: { email, displayName, passwordHash: await hashPassword(password), isAdmin: true },
  });
  console.log(`Admin ${email} angelegt.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
