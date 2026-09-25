import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { auditLogs, clientProfiles, complianceAlerts, depositRequests, idempotencyKeys, kycCases, kycDocuments, legalAcceptances, localCredentials, notifications, orders, positions, riskLimits, users, walletTransactions, wallets, watchlistItems, watchlists, withdrawalRequests } from "../drizzle/schema";
import { getDb, getOrCreateRiskLimit, writeAuditLog } from "./db";
import type { PlatformRole } from "@shared/permissions";
import { createApprovalRequest } from "./adminApprovals";
import { hashPassword, normalizeEmail } from "./localAuth";

export type AdminUserRole = "user" | "compliance" | "admin" | "super_admin";
export type AdminUserStatus = "active" | "restricted" | "blocked";

export function canChangeUserRole(actorUserId: number, targetUserId: number, currentRole: AdminUserRole, nextRole: AdminUserRole) {
  if (actorUserId === targetUserId && nextRole !== currentRole) return false;
  return true;
}

export function canChangeUserStatus(actorUserId: number, targetUserId: number, nextStatus: AdminUserStatus) {
  if (actorUserId === targetUserId && nextStatus !== "active") return false;
  return true;
}

export function buildUserAdminAudit(action: string, targetUserId: number, reason: string, previousValue: string, nextValue: string) {
  return { action, entityType: "user", entityId: String(targetUserId), severity: nextValue === "blocked" ? "critical" as const : "warning" as const, metadata: { reason, previousValue, nextValue } };
}

function matchesSearch(user: typeof users.$inferSelect, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [user.name, user.email, user.openId, String(user.id)].some(value => value?.toLowerCase().includes(needle));
}

export async function listAdminUsers(input: { search: string; role: "all" | PlatformRole; status: "all" | AdminUserStatus; page: number; pageSize: number }) {
  const db = await getDb();
  if (!db) return { items: [], total: 0, page: input.page, pageSize: input.pageSize };
  const userRows = await db.select().from(users).orderBy(desc(users.updatedAt)).limit(500);
  const userIds = userRows.map(user => user.id);
  const [profileRows, kycRows, limitRows, alertRows, walletRows] = await Promise.all([
    userIds.length ? db.select().from(clientProfiles).where(inArray(clientProfiles.userId, userIds)) : [],
    userIds.length ? db.select().from(kycCases).where(inArray(kycCases.userId, userIds)).orderBy(desc(kycCases.updatedAt)) : [],
    userIds.length ? db.select().from(riskLimits).where(inArray(riskLimits.userId, userIds)) : [],
    userIds.length ? db.select().from(complianceAlerts).where(and(inArray(complianceAlerts.userId, userIds), inArray(complianceAlerts.status, ["open", "investigating"]))) : [],
    userIds.length ? db.select().from(wallets).where(inArray(wallets.userId, userIds)) : [],
  ]);
  const filtered = userRows.filter(user => {
    const limit = limitRows.find(row => row.userId === user.id);
    return matchesSearch(user, input.search) && (input.role === "all" || user.role === input.role) && (input.status === "all" || (limit?.status ?? "active") === input.status);
  });
  const start = (input.page - 1) * input.pageSize;
  const items = filtered.slice(start, start + input.pageSize).map(user => {
    const limit = limitRows.find(row => row.userId === user.id);
    const kyc = kycRows.find(row => row.userId === user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      accountStatus: limit?.status ?? "active",
      kycStatus: kyc?.status ?? "not_started",
      riskLevel: kyc?.riskLevel ?? "medium",
      openAlerts: alertRows.filter(row => row.userId === user.id).length,
      wallets: walletRows.filter(row => row.userId === user.id).map(row => ({ currency: row.currency, availableBalance: row.availableBalance, status: row.status })),
      createdAt: user.createdAt,
      lastSignedIn: user.lastSignedIn,
    };
  });
  return { items, total: filtered.length, page: input.page, pageSize: input.pageSize };
}

export async function getAdminUserDetail(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) return null;
  const [profile, kyc, limits, alerts, userWallets, audits] = await Promise.all([
    db.select().from(clientProfiles).where(eq(clientProfiles.userId, userId)).limit(1),
    db.select().from(kycCases).where(eq(kycCases.userId, userId)).orderBy(desc(kycCases.updatedAt)).limit(1),
    db.select().from(riskLimits).where(eq(riskLimits.userId, userId)).limit(1),
    db.select().from(complianceAlerts).where(eq(complianceAlerts.userId, userId)).orderBy(desc(complianceAlerts.createdAt)).limit(25),
    db.select().from(wallets).where(eq(wallets.userId, userId)).orderBy(wallets.currency),
    db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, String(userId)))).orderBy(desc(auditLogs.createdAt)).limit(25),
  ]);
  return { user, profile: profile[0] ?? null, kyc: kyc[0] ?? null, limits: limits[0] ?? null, alerts, wallets: userWallets, audit: audits };
}

export async function updateAdminUserStatus(input: { actorUserId: number; targetUserId: number; status: AdminUserStatus; reason: string }) {
  if (!canChangeUserStatus(input.actorUserId, input.targetUserId, input.status)) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas se bloquer lui-même." });
  const db = await getDb();
  const target = db ? (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0] : undefined;
  if (db && !target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  const current = db ? (await db.select().from(riskLimits).where(eq(riskLimits.userId, input.targetUserId)).limit(1))[0] : undefined;
  if (db) {
    await getOrCreateRiskLimit(input.targetUserId);
    await db.update(riskLimits).set({ status: input.status, updatedBy: input.actorUserId }).where(eq(riskLimits.userId, input.targetUserId));
  }
  await writeAuditLog({ ...buildUserAdminAudit("admin.user_status_updated", input.targetUserId, input.reason, current?.status ?? "active", input.status), actorUserId: input.actorUserId });
  return { success: true, status: input.status };
}

export async function updateAdminUserRole(input: { actorUserId: number; targetUserId: number; role: AdminUserRole; reason: string }) {
  if (input.actorUserId === input.targetUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas modifier son propre rôle." });
  const db = await getDb();
  const current = db ? (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0] : undefined;
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  if (!canChangeUserRole(input.actorUserId, input.targetUserId, current.role, input.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas modifier son propre rôle." });
  if (db) await db.update(users).set({ role: input.role }).where(eq(users.id, input.targetUserId));
  await writeAuditLog({ ...buildUserAdminAudit("admin.user_role_updated", input.targetUserId, input.reason, current.role, input.role), actorUserId: input.actorUserId });
  return { success: true, role: input.role };
}

export async function requestAdminUserStatus(input: { actorUserId: number; targetUserId: number; status: AdminUserStatus; reason: string }) {
  if (!canChangeUserStatus(input.actorUserId, input.targetUserId, input.status)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas se bloquer lui-même." });
  }
  const db = await getDb();
  if (db) {
    const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  }
  return createApprovalRequest({ actionType: "account_status", requesterUserId: input.actorUserId, targetUserId: input.targetUserId, payload: { targetUserId: input.targetUserId, status: input.status }, reason: input.reason });
}

export async function setSuperAdminUserStatus(input: { actorUserId: number; targetUserId: number; status: AdminUserStatus; reason: string }) {
  if (!canChangeUserStatus(input.actorUserId, input.targetUserId, input.status)) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas se suspendre lui-même." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour modifier le statut." });
  const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  const current = (await db.select().from(riskLimits).where(eq(riskLimits.userId, input.targetUserId)).limit(1))[0];
  await getOrCreateRiskLimit(input.targetUserId);
  await db.update(riskLimits).set({ status: input.status, updatedBy: input.actorUserId }).where(eq(riskLimits.userId, input.targetUserId));
  await writeAuditLog({ ...buildUserAdminAudit("admin.user_status_updated_directly", input.targetUserId, input.reason, current?.status ?? "active", input.status), actorUserId: input.actorUserId });
  return { success: true as const, status: input.status };
}

export async function createAdminAccount(input: { actorUserId: number; name: string; email: string; password: string; reason: string }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour créer un administrateur." });
  const email = normalizeEmail(input.email);
  const existing = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (existing) throw new TRPCError({ code: "CONFLICT", message: "Cette adresse email est déjà utilisée." });
  const credential = (await db.select().from(localCredentials).where(eq(localCredentials.email, email)).limit(1))[0];
  if (credential) throw new TRPCError({ code: "CONFLICT", message: "Cette adresse email est déjà utilisée." });
  const openId = `local-admin-${createHash("sha256").update(email).digest("hex").slice(0, 48)}`;
  const passwordHash = await hashPassword(input.password);
  let createdUserId = 0;
  await db.transaction(async tx => {
    const inserted = await tx.insert(users).values({ openId, name: input.name.trim(), email, loginMethod: "email", role: "admin" });
    createdUserId = Number(inserted[0].insertId);
    await tx.insert(localCredentials).values({ userId: createdUserId, email, passwordHash, emailVerifiedAt: new Date() });
    await tx.insert(clientProfiles).values({ userId: createdUserId, country: "RDC", preferredCurrency: "USD", investorExperience: "none", riskProfile: "unassessed" });
    await tx.insert(riskLimits).values({ userId: createdUserId, status: "active" });
    await tx.insert(wallets).values([{ userId: createdUserId, currency: "USD" }, { userId: createdUserId, currency: "CDF" }]);
    await tx.insert(kycCases).values({ userId: createdUserId, status: "not_started", riskLevel: "medium" });
  });
  await writeAuditLog({ actorUserId: input.actorUserId, action: "admin.account_created", entityType: "user", entityId: String(createdUserId), severity: "warning", metadata: { reason: input.reason, email, role: "admin" } });
  return { success: true as const, userId: createdUserId, email, role: "admin" as const, emailVerified: true as const };
}

export async function requestAdminUserRole(input: { actorUserId: number; targetUserId: number; role: AdminUserRole; reason: string }) {
  if (input.actorUserId === input.targetUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas modifier son propre rôle." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  return createApprovalRequest({ actionType: "role_change", requesterUserId: input.actorUserId, targetUserId: input.targetUserId, payload: { targetUserId: input.targetUserId, role: input.role }, reason: input.reason });
}

export async function reviewAdminUserKyc(input: { actorUserId: number; targetUserId: number; status: "approved" | "rejected" | "needs_action"; note: string }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour revoir un dossier KYC." });
  const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  const current = (await db.select().from(kycCases).where(eq(kycCases.userId, input.targetUserId)).orderBy(desc(kycCases.updatedAt)).limit(1))[0];
  if (current) {
    await db.update(kycCases).set({ status: input.status, reviewNote: input.note, reviewedBy: input.actorUserId, reviewedAt: new Date() }).where(eq(kycCases.id, current.id));
  } else {
    await db.insert(kycCases).values({ userId: input.targetUserId, status: input.status, reviewNote: input.note, reviewedBy: input.actorUserId, reviewedAt: new Date() });
  }
  await db.insert(notifications).values({ userId: input.targetUserId, type: "kyc", title: "Mise à jour de votre dossier KYC", message: input.note });
  await writeAuditLog({ actorUserId: input.actorUserId, action: `kyc.${input.status}`, entityType: "user", entityId: String(input.targetUserId), severity: input.status === "rejected" ? "warning" : "info", metadata: { note: input.note } });
  return { success: true, status: input.status };
}

export async function updateAdminUserAccount(input: { actorUserId: number; targetUserId: number; name: string; email: string; reason: string }) {
  if (input.actorUserId === input.targetUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas modifier son propre compte depuis cette console." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour modifier un compte." });
  const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  const email = normalizeEmail(input.email);
  const duplicate = (await db.select().from(localCredentials).where(eq(localCredentials.email, email)).limit(1))[0];
  if (duplicate && duplicate.userId !== input.targetUserId) throw new TRPCError({ code: "CONFLICT", message: "Cette adresse email est déjà utilisée." });
  await db.transaction(async tx => {
    await tx.update(users).set({ name: input.name.trim(), email }).where(eq(users.id, input.targetUserId));
    await tx.update(localCredentials).set({ email }).where(eq(localCredentials.userId, input.targetUserId));
  });
  await writeAuditLog({ actorUserId: input.actorUserId, action: "admin.user_account_updated", entityType: "user", entityId: String(input.targetUserId), severity: "warning", metadata: { reason: input.reason, previousName: target.name, previousEmail: target.email, nextName: input.name.trim(), nextEmail: email } });
  return { success: true as const };
}

export async function deleteAdminUser(input: { actorUserId: number; targetUserId: number; reason: string }) {
  if (input.actorUserId === input.targetUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas supprimer son propre compte." });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour supprimer un compte." });
  const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  if (target.role === "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "La suppression d’un compte Super Admin est désactivée." });
  await db.transaction(async tx => {
    const userWallets = await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.userId, input.targetUserId));
    const walletIds = userWallets.map(wallet => wallet.id);
    const cases = await tx.select({ id: kycCases.id }).from(kycCases).where(eq(kycCases.userId, input.targetUserId));
    const caseIds = cases.map(item => item.id);
    const lists = await tx.select({ id: watchlists.id }).from(watchlists).where(eq(watchlists.userId, input.targetUserId));
    const listIds = lists.map(item => item.id);
    if (caseIds.length) await tx.delete(kycDocuments).where(inArray(kycDocuments.kycCaseId, caseIds));
    if (listIds.length) await tx.delete(watchlistItems).where(inArray(watchlistItems.watchlistId, listIds));
    if (walletIds.length) await tx.delete(walletTransactions).where(inArray(walletTransactions.walletId, walletIds));
    await tx.delete(localCredentials).where(eq(localCredentials.userId, input.targetUserId));
    await tx.delete(clientProfiles).where(eq(clientProfiles.userId, input.targetUserId));
    await tx.delete(kycCases).where(eq(kycCases.userId, input.targetUserId));
    await tx.delete(riskLimits).where(eq(riskLimits.userId, input.targetUserId));
    await tx.delete(depositRequests).where(eq(depositRequests.userId, input.targetUserId));
    await tx.delete(withdrawalRequests).where(eq(withdrawalRequests.userId, input.targetUserId));
    await tx.delete(orders).where(eq(orders.userId, input.targetUserId));
    await tx.delete(positions).where(eq(positions.userId, input.targetUserId));
    await tx.delete(notifications).where(eq(notifications.userId, input.targetUserId));
    await tx.delete(complianceAlerts).where(eq(complianceAlerts.userId, input.targetUserId));
    await tx.delete(legalAcceptances).where(eq(legalAcceptances.userId, input.targetUserId));
    await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.userId, input.targetUserId));
    await tx.delete(watchlists).where(eq(watchlists.userId, input.targetUserId));
    await tx.delete(wallets).where(eq(wallets.userId, input.targetUserId));
    await tx.delete(users).where(eq(users.id, input.targetUserId));
  });
  await writeAuditLog({ actorUserId: input.actorUserId, action: "admin.user_account_deleted", entityType: "user", entityId: String(input.targetUserId), severity: "critical", metadata: { reason: input.reason, previousEmail: target.email, previousRole: target.role } });
  return { success: true as const };
}

export async function adjustAdminUserWallet(input: { actorUserId: number; targetUserId: number; currency: "CDF" | "USD"; direction: "credit" | "debit"; amount: number; reason: string }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour ajuster un wallet." });
  if (input.amount <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Le montant doit être supérieur à zéro." });
  const target = (await db.select().from(users).where(eq(users.id, input.targetUserId)).limit(1))[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilisateur introuvable." });
  const amount = input.amount.toFixed(8);
  await db.transaction(async tx => {
    const wallet = (await tx.select().from(wallets).where(and(eq(wallets.userId, input.targetUserId), eq(wallets.currency, input.currency))).limit(1))[0];
    if (!wallet) throw new TRPCError({ code: "NOT_FOUND", message: "Wallet introuvable pour cette devise." });
    if (input.direction === "debit" && Number(wallet.availableBalance) < input.amount) throw new TRPCError({ code: "BAD_REQUEST", message: "Solde disponible insuffisant pour ce débit." });
    const nextBalance = input.direction === "credit" ? Number(wallet.availableBalance) + input.amount : Number(wallet.availableBalance) - input.amount;
    await tx.update(wallets).set({ availableBalance: nextBalance.toFixed(8) }).where(eq(wallets.id, wallet.id));
    await tx.insert(walletTransactions).values({ walletId: wallet.id, userId: input.targetUserId, type: "adjustment", direction: input.direction, amount, currency: input.currency, status: "completed", reference: `ADMIN-${input.direction.toUpperCase()}-${nanoid(12).toUpperCase()}`, description: input.reason, completedAt: new Date() });
  });
  await writeAuditLog({ actorUserId: input.actorUserId, action: `admin.wallet_${input.direction}`, entityType: "wallet", entityId: String(input.targetUserId), severity: input.direction === "debit" ? "warning" : "info", metadata: { reason: input.reason, amount: input.amount, currency: input.currency } });
  return { success: true as const };
}
