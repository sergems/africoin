import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  auditLogs,
  clientProfiles,
  complianceAlerts,
  depositRequests,
  instruments,
  kycCases,
  notifications,
  orders,
  idempotencyKeys,
  reconciliationRecords,
  riskLimits,
  watchlists,
  watchlistItems,
  positions,
  users,
  walletTransactions,
  wallets,
  withdrawalRequests,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export function resolveUpsertRole(openId: string, requestedRole: InsertUser["role"], ownerOpenId: string) {
  return openId === ownerOpenId ? "super_admin" as const : requestedRole;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  const resolvedRole = user.role;
  if (resolvedRole !== undefined) {
    values.role = resolvedRole;
    updateSet.role = resolvedRole;
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  return result[0];
}

export async function ensureClientProfile(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const existing = await db.select().from(clientProfiles).where(eq(clientProfiles.userId, userId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(clientProfiles).values({ userId });
  const created = await db.select().from(clientProfiles).where(eq(clientProfiles.userId, userId)).limit(1);
  return created[0];
}

export async function getInstruments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(instruments).where(eq(instruments.status, "active")).orderBy(instruments.assetClass, instruments.symbol);
}

export async function getUserWallets(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wallets).where(eq(wallets.userId, userId)).orderBy(wallets.currency);
}

export async function getUserPositions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(positions).where(eq(positions.userId, userId));
  const ids = rows.map(row => row.instrumentId);
  if (!ids.length) return [];
  const catalog = await db.select().from(instruments).where(inArray(instruments.id, ids));
  return rows.map(row => ({ ...row, instrument: catalog.find(item => item.id === row.instrumentId) ?? null }));
}

export async function getUserOrders(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(limit);
  const ids = rows.map(row => row.instrumentId);
  const catalog = ids.length ? await db.select().from(instruments).where(inArray(instruments.id, ids)) : [];
  return rows.map(row => ({ ...row, instrument: catalog.find(item => item.id === row.instrumentId) ?? null }));
}

export async function getUserTransactions(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(walletTransactions).where(eq(walletTransactions.userId, userId)).orderBy(desc(walletTransactions.createdAt)).limit(limit);
}

export async function getUserRequests(userId: number) {
  const db = await getDb();
  if (!db) return { deposits: [], withdrawals: [] };
  const [deposits, withdrawals] = await Promise.all([
    db.select().from(depositRequests).where(eq(depositRequests.userId, userId)).orderBy(desc(depositRequests.createdAt)).limit(10),
    db.select().from(withdrawalRequests).where(eq(withdrawalRequests.userId, userId)).orderBy(desc(withdrawalRequests.createdAt)).limit(10),
  ]);
  return { deposits, withdrawals };
}

export async function getKycCase(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(kycCases).where(eq(kycCases.userId, userId)).orderBy(desc(kycCases.updatedAt)).limit(1);
  return rows[0];
}

export async function getUserNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(15);
}

export async function writeAuditLog(input: {
  actorUserId?: number;
  action: string;
  entityType: string;
  entityId?: string;
  severity?: "info" | "warning" | "critical";
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    severity: input.severity ?? "info",
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    ipAddress: input.ipAddress,
  });
}

export async function getComplianceQueue() {
  const db = await getDb();
  if (!db) return { kyc: [], alerts: [], deposits: [], withdrawals: [] };
  const [kyc, alerts, deposits, withdrawals] = await Promise.all([
    db.select().from(kycCases).orderBy(desc(kycCases.updatedAt)).limit(50),
    db.select().from(complianceAlerts).where(inArray(complianceAlerts.status, ["open", "investigating"])).orderBy(desc(complianceAlerts.createdAt)).limit(50),
    db.select().from(depositRequests).where(inArray(depositRequests.status, ["requested", "pending_review", "processing"])).orderBy(desc(depositRequests.createdAt)).limit(50),
    db.select().from(withdrawalRequests).where(inArray(withdrawalRequests.status, ["requested", "pending_review", "processing", "blocked"])).orderBy(desc(withdrawalRequests.createdAt)).limit(50),
  ]);
  return { kyc, alerts, deposits, withdrawals };
}

export async function getAuditLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export async function getUserWatchlist(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const lists = await db.select().from(watchlists).where(eq(watchlists.userId, userId)).limit(1);
  if (!lists[0]) return [];
  const items = await db.select().from(watchlistItems).where(eq(watchlistItems.watchlistId, lists[0].id));
  const ids = items.map(item => item.instrumentId);
  const catalog = ids.length ? await db.select().from(instruments).where(inArray(instruments.id, ids)) : [];
  return items.map(item => ({ ...item, instrument: catalog.find(row => row.id === item.instrumentId) ?? null }));
}

export async function getOrCreateRiskLimit(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const found = await db.select().from(riskLimits).where(eq(riskLimits.userId, userId)).limit(1);
  if (found[0]) return found[0];
  await db.insert(riskLimits).values({ userId });
  const created = await db.select().from(riskLimits).where(eq(riskLimits.userId, userId)).limit(1);
  return created[0];
}

export async function getReconciliationQueue() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reconciliationRecords).where(inArray(reconciliationRecords.status, ["unmatched", "exception"])).orderBy(desc(reconciliationRecords.createdAt)).limit(100);
}

export async function getDbHealth() {
  const db = await getDb();
  if (!db) return { connected: false };
  return { connected: true };
}

export { and };

export async function getIdempotentResponse(userId: number, key: string, operation: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation))).limit(1);
  return rows[0]?.response ? JSON.parse(rows[0].response) : undefined;
}

export async function saveIdempotentResponse(userId: number, key: string, operation: string, response: unknown) {
  const db = await getDb();
  if (!db) return;
  await db.insert(idempotencyKeys).values({ userId, key, operation, response: JSON.stringify(response) }).onDuplicateKeyUpdate({ set: { response: JSON.stringify(response) } });
}
