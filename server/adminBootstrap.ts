import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { clientProfiles, kycCases, localCredentials, users, wallets } from "../drizzle/schema";
import { getDb, getOrCreateRiskLimit, ensureClientProfile } from "./db";
import { hashPassword, normalizeEmail, verifyPassword } from "./localAuth";

async function main() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  const role = process.env.ADMIN_ROLE === "super_admin" ? "super_admin" : "admin";
  if (!email || !email.includes("@")) throw new Error("ADMIN_EMAIL must be a valid email address.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");

  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL is required to bootstrap the admin account.");

  const openId = `local-admin-${createHash("sha256").update(email).digest("hex").slice(0, 48)}`;
  const existingByEmail = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  let account = existingByEmail;

  if (account) {
    await db.update(users).set({ name: account.name || "Serge Admin", role, loginMethod: "email" }).where(eq(users.id, account.id));
  } else {
    await db.insert(users).values({ openId, name: "Serge Admin", email, loginMethod: "email", role });
    account = (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
  }

  if (!account) throw new Error("Admin account could not be created or located.");

  const passwordHash = await hashPassword(password);
  const existingCredentials = (await db.select().from(localCredentials).where(eq(localCredentials.userId, account.id)).limit(1))[0];
  if (existingCredentials) {
    await db.update(localCredentials).set({ email, passwordHash, emailVerifiedAt: new Date(), verificationTokenHash: null, verificationExpiresAt: null }).where(eq(localCredentials.userId, account.id));
  } else {
    await db.insert(localCredentials).values({ userId: account.id, email, passwordHash, emailVerifiedAt: new Date() });
  }

  await ensureClientProfile(account.id);
  await getOrCreateRiskLimit(account.id);
  for (const currency of ["USD", "CDF"] as const) {
    const wallet = (await db.select().from(wallets).where(and(eq(wallets.userId, account.id), eq(wallets.currency, currency))).limit(1))[0];
    if (!wallet) await db.insert(wallets).values({ userId: account.id, currency });
  }
  const existingKyc = (await db.select().from(kycCases).where(eq(kycCases.userId, account.id)).limit(1))[0];
  if (!existingKyc) await db.insert(kycCases).values({ userId: account.id, status: "not_started", riskLevel: "medium" });

  const savedCredentials = (await db.select().from(localCredentials).where(eq(localCredentials.userId, account.id)).limit(1))[0];
  const verified = Boolean(savedCredentials?.emailVerifiedAt && savedCredentials?.passwordHash && await verifyPassword(password, savedCredentials.passwordHash));
  if (!verified) throw new Error("Admin credentials could not be verified after bootstrap.");

  console.log(JSON.stringify({ success: true, userId: account.id, email, role, emailVerified: true }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
