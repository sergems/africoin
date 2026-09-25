import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { router, publicProcedure, protectedProcedure, adminProcedure, permissionProcedure } from "./_core/trpc";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  auditLogs,
  clientProfiles,
  complianceAlerts,
  depositRequests,
  idempotencyKeys,
  reconciliationRecords,
  reconciliationHistory,
  riskLimits,
  watchlists,
  watchlistItems,
  legalDocuments,
  legalAcceptances,
  instruments,
  kycCases,
  kycDocuments,
  notifications,
  orders,
  positions,
  wallets,
  walletTransactions,
  withdrawalRequests,
  users,
  localCredentials,
} from "../drizzle/schema";
import { getDb } from "./db";
import { pendingActivationInstruments } from "./marketCatalog";
import {
  ensureClientProfile,
  getAuditLogs,
  getComplianceQueue,
  getInstruments,
  getKycCase,
  getUserNotifications,
  getUserOrders,
  getUserPositions,
  getUserRequests,
  getUserTransactions,
  getUserWallets,
  getUserWatchlist,
  getOrCreateRiskLimit,
  getReconciliationQueue,
  getIdempotentResponse,
  saveIdempotentResponse,
  writeAuditLog,
} from "./db";
import { getProviderRegistry } from "./providers";
import { buildFundingDecisionNotification } from "./notificationService";
import { storageGetSignedUrl, storagePut } from "./storage";
import { adjustAdminUserWallet, deleteAdminUser, getAdminUserDetail, listAdminUsers, requestAdminUserRole, requestAdminUserStatus, reviewAdminUserKyc, updateAdminUserAccount } from "./adminUsers";
import { createApprovalRequest, decideApproval, listApprovalRequests } from "./adminApprovals";
import { hashPassword, normalizeEmail, verifyPassword } from "./localAuth";
import { sdk } from "./_core/sdk";
import type { TrpcContext } from "./_core/context";
import { evaluateTradingEligibility, resolveTradeExecutionMode } from "./tradingGuards";
import { processTriggeredInternalOrders } from "./internalBroker";

const requireCompliance = permissionProcedure("kyc.review");

const randomReference = (prefix: string) => `${prefix}-${nanoid(12).toUpperCase()}`;

async function setLocalSession(ctx: Pick<TrpcContext, "req" | "res">, openId: string, name: string) {
  const sessionToken = await sdk.createSessionToken(openId, { name, expiresInMs: ONE_YEAR_MS });
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
}

function exposeVerificationToken(token: string) {
  return process.env.NODE_ENV === "production" ? undefined : token;
}


async function ensureWallet(userId: number, currency: "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH") {
  const db = await getDb();
  if (!db) return undefined;
  const found = await db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.currency, currency))).limit(1);
  if (found[0]) return found[0];
  await db.insert(wallets).values({ userId, currency });
  const created = await db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.currency, currency))).limit(1);
  return created[0];
}

const hasConnectedProvider = (category: "payments" | "brokerage") => getProviderRegistry().some(provider => provider.category === category && provider.connected && provider.mode === "live");

export const appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ ok: true, mode: "pending_activation-safe" as const })),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    register: publicProcedure.input(z.object({ firstName: z.string().trim().min(2).max(80), lastName: z.string().trim().min(2).max(80), email: z.string().trim().email().max(320), password: z.string().min(8).max(128), phone: z.string().trim().min(7).max(40), country: z.string().trim().min(2).max(80), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de naissance invalide."), address: z.string().trim().min(5).max(255), city: z.string().trim().min(2).max(100), occupation: z.string().trim().min(2).max(120), sourceOfFunds: z.enum(["salary", "business", "investments", "savings", "inheritance", "other"]), preferredCurrency: z.enum(["CDF", "USD"]), investorExperience: z.enum(["none", "beginner", "intermediate", "advanced"]), acceptTerms: z.literal(true) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données n’est pas configurée." });
      const email = normalizeEmail(input.email);
      const existing = await db.select().from(localCredentials).where(eq(localCredentials.email, email)).limit(1);
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "Un compte existe déjà avec cette adresse email." });
      const openId = `local_${nanoid(32)}`;
      const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`;
      await db.insert(users).values({ openId, name: fullName, email, loginMethod: "email", role: "user" });
      const createdUser = (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
      if (!createdUser) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Le compte n’a pas pu être créé." });
      await db.insert(localCredentials).values({ userId: createdUser.id, email, passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() });
      await db.insert(clientProfiles).values({ userId: createdUser.id, phone: input.phone.trim(), country: input.country.trim(), dateOfBirth: input.dateOfBirth, address: input.address.trim(), city: input.city.trim(), occupation: input.occupation.trim(), sourceOfFunds: input.sourceOfFunds, preferredCurrency: input.preferredCurrency, investorExperience: input.investorExperience });
      await getOrCreateRiskLimit(createdUser.id);
      await db.insert(kycCases).values({ userId: createdUser.id, status: "not_started", riskLevel: "medium" });
      await db.insert(wallets).values([{ userId: createdUser.id, currency: "USD" }, { userId: createdUser.id, currency: "CDF" }]);
      await writeAuditLog({ actorUserId: createdUser.id, action: "account.registered", entityType: "user", entityId: String(createdUser.id), metadata: { method: "email" }, ipAddress: ctx.req.ip });
      return { success: true as const, userId: createdUser.id };
    }),
    login: publicProcedure.input(z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données n’est pas configurée." });
      const email = normalizeEmail(input.email);
      const credentials = (await db.select().from(localCredentials).where(eq(localCredentials.email, email)).limit(1))[0];
      if (!credentials || !(await verifyPassword(input.password, credentials.passwordHash))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Email ou mot de passe incorrect." });
      const user = (await db.select().from(users).where(eq(users.id, credentials.userId)).limit(1))[0];
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Compte introuvable." });
      const limits = await getOrCreateRiskLimit(user.id);
      if (limits?.status === "blocked") throw new TRPCError({ code: "FORBIDDEN", message: "Ce compte est bloqué. Contactez la conformité." });
      await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));
      await setLocalSession(ctx, user.openId, user.name ?? email);
      return { success: true as const, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  kyc: router({
    documents: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { case: null, documents: [] };
      const current = (await db.select().from(kycCases).where(eq(kycCases.userId, ctx.user.id)).orderBy(desc(kycCases.updatedAt)).limit(1))[0];
      if (!current) return { case: null, documents: [] };
      const rows = await db.select().from(kycDocuments).where(eq(kycDocuments.kycCaseId, current.id)).orderBy(desc(kycDocuments.createdAt));
      return { case: current, documents: await Promise.all(rows.map(async row => ({ ...row, url: await storageGetSignedUrl(row.storageKey).catch(() => null) }))) };
    }),
    uploadDocument: protectedProcedure.input(z.object({ documentType: z.enum(["identity", "address", "source_of_funds", "corporate", "other"]), fileName: z.string().min(1).max(255), mimeType: z.enum(["image/jpeg", "image/png", "application/pdf"]), base64: z.string().min(16).max(14000000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour envoyer un document." });
      const existing = await db.select().from(kycCases).where(eq(kycCases.userId, ctx.user.id)).orderBy(desc(kycCases.createdAt)).limit(1);
      let kycCase = existing[0];
      if (!kycCase) { await db.insert(kycCases).values({ userId: ctx.user.id, status: "pending", riskLevel: "medium" }); kycCase = (await db.select().from(kycCases).where(eq(kycCases.userId, ctx.user.id)).orderBy(desc(kycCases.createdAt)).limit(1))[0]; }
      if (!kycCase) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Dossier KYC indisponible." });
      if (kycCase.status === "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Votre dossier KYC est déjà approuvé." });
      const bytes = Buffer.from(input.base64, "base64");
      if (bytes.length > 10 * 1024 * 1024) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Document trop volumineux." });
      const stored = await storagePut(`private-kyc/${ctx.user.id}/${input.fileName}`, bytes, input.mimeType);
      await db.insert(kycDocuments).values({ kycCaseId: kycCase.id, documentType: input.documentType, fileName: input.fileName, storageKey: stored.key, mimeType: input.mimeType, status: "uploaded" });
      await db.update(kycCases).set({ status: "pending" }).where(eq(kycCases.id, kycCase.id));
      await db.insert(notifications).values({ userId: ctx.user.id, type: "kyc", title: "Document KYC reçu", message: `${input.fileName} a été enregistré pour revue.` });
      await writeAuditLog({ actorUserId: ctx.user.id, action: "kyc.document_uploaded", entityType: "kyc_document", entityId: String(kycCase.id), metadata: { documentType: input.documentType, mimeType: input.mimeType } });
      return { status: "uploaded" as const, mode: "pending_activation" as const, key: stored.key };
    }),
  }),
  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const items = await getUserNotifications(ctx.user.id);
      return { items, unreadCount: items.filter(item => !item.readAt).length, serverTime: new Date() };
    }),
    markRead: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (db) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id))); return { success: true }; }),
    markAllRead: protectedProcedure.mutation(async ({ ctx }) => { const db = await getDb(); if (db) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt))); return { success: true }; }),
  }),
  integrations: router({
    status: protectedProcedure.query(() => ({ mode: "pending_activation" as const, providers: getProviderRegistry() })),
  }),
  profile: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const profile = await ensureClientProfile(ctx.user.id);
      return profile ?? { id: 0, userId: ctx.user.id, phone: null, country: "RDC", preferredCurrency: "USD" as const, investorExperience: "none" as const, riskProfile: "unassessed" as const, riskScore: null, createdAt: new Date(), updatedAt: new Date() };
    }),
    update: protectedProcedure.input(z.object({ phone: z.string().max(40).optional(), country: z.string().max(80).optional(), dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), address: z.string().max(255).optional(), city: z.string().max(100).optional(), occupation: z.string().max(120).optional(), sourceOfFunds: z.enum(["salary", "business", "investments", "savings", "inheritance", "other"]).optional(), preferredCurrency: z.enum(["CDF", "USD"]).optional(), investorExperience: z.enum(["none", "beginner", "intermediate", "advanced"]).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { ...input, userId: ctx.user.id };
      await ensureClientProfile(ctx.user.id);
      await db.update(clientProfiles).set(input).where(eq(clientProfiles.userId, ctx.user.id));
      await writeAuditLog({ actorUserId: ctx.user.id, action: "profile.updated", entityType: "client_profile", entityId: String(ctx.user.id) });
      return db.select().from(clientProfiles).where(eq(clientProfiles.userId, ctx.user.id)).limit(1).then(rows => rows[0]);
    }),
  }),
  dashboard: router({
    summary: protectedProcedure.query(async ({ ctx }) => {
      const [walletRows, positionRows, ordersRows, kyc, notificationsRows] = await Promise.all([
        getUserWallets(ctx.user.id),
        getUserPositions(ctx.user.id),
        getUserOrders(ctx.user.id, 5),
        getKycCase(ctx.user.id),
        getUserNotifications(ctx.user.id),
      ]);
      const walletsView = walletRows.length ? walletRows : [
        { id: 0, userId: ctx.user.id, currency: "USD", availableBalance: "0.00", pendingBalance: "0.00", status: "active" },
        { id: 0, userId: ctx.user.id, currency: "CDF", availableBalance: "0.00", pendingBalance: "0.00", status: "active" },
      ];
      return { mode: "pending_activation", wallets: walletsView, positions: positionRows, recentOrders: ordersRows, kyc: kyc ?? { status: "not_started", riskLevel: "medium" }, notifications: notificationsRows };
    }),
  }),
  market: router({
    catalog: publicProcedure.input(z.object({ query: z.string().optional(), assetClass: z.enum(["all", "equity", "fx_spot"]).default("all") }).optional()).query(async ({ input }) => {
      const dbRows = await getInstruments();
      const rows = dbRows.length ? dbRows : pendingActivationInstruments;
      await Promise.all(rows.map(row => processTriggeredInternalOrders(Number(row.id), Number(row.price))));
      const query = input?.query?.trim().toLowerCase() ?? "";
      return rows.filter(row => (input?.assetClass === "all" || !input?.assetClass || row.assetClass === input.assetClass) && (!query || row.symbol.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)));
    }),
    quote: publicProcedure.input(z.object({ symbol: z.string() })).query(async ({ input }) => {
      const rows = await getInstruments();
      const found = rows.find(row => row.symbol === input.symbol) ?? pendingActivationInstruments.find(row => row.symbol === input.symbol);
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument introuvable." });
      await processTriggeredInternalOrders(Number(found.id), Number(found.price));
      return { ...found, asOf: new Date(), source: found.provider === "pending_activation" ? "Source partenaire en cours de connexion" : found.provider };
    }),
  }),
  watchlist: router({
    list: protectedProcedure.query(({ ctx }) => getUserWatchlist(ctx.user.id)),
    add: protectedProcedure.input(z.object({ instrumentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      const existingList = await db.select().from(watchlists).where(eq(watchlists.userId, ctx.user.id)).limit(1);
      let list = existingList[0];
      if (!list) { await db.insert(watchlists).values({ userId: ctx.user.id, name: "Ma liste" }); list = (await db.select().from(watchlists).where(eq(watchlists.userId, ctx.user.id)).limit(1))[0]; }
      if (!list) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Watchlist indisponible." });
      const already = await db.select().from(watchlistItems).where(and(eq(watchlistItems.watchlistId, list.id), eq(watchlistItems.instrumentId, input.instrumentId))).limit(1);
      if (!already[0]) await db.insert(watchlistItems).values({ watchlistId: list.id, instrumentId: input.instrumentId });
      await writeAuditLog({ actorUserId: ctx.user.id, action: "watchlist.added", entityType: "instrument", entityId: String(input.instrumentId) });
      return { success: true };
    }),
    remove: protectedProcedure.input(z.object({ instrumentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (db) { const list = (await db.select().from(watchlists).where(eq(watchlists.userId, ctx.user.id)).limit(1))[0]; if (list) await db.delete(watchlistItems).where(and(eq(watchlistItems.watchlistId, list.id), eq(watchlistItems.instrumentId, input.instrumentId))); }
      return { success: true };
    }),
  }),
  legal: router({
    list: publicProcedure.query(async () => { const db = await getDb(); return db ? db.select().from(legalDocuments).orderBy(desc(legalDocuments.publishedAt)) : []; }),
    accept: protectedProcedure.input(z.object({ legalDocumentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (db) await db.insert(legalAcceptances).values({ userId: ctx.user.id, legalDocumentId: input.legalDocumentId }); await writeAuditLog({ actorUserId: ctx.user.id, action: "legal.accepted", entityType: "legal_document", entityId: String(input.legalDocumentId) }); return { success: true }; }),
  }),
  portfolio: router({
    positions: protectedProcedure.query(({ ctx }) => getUserPositions(ctx.user.id)),
    transactions: protectedProcedure.query(({ ctx }) => getUserTransactions(ctx.user.id)),
    requests: protectedProcedure.query(({ ctx }) => getUserRequests(ctx.user.id)),
  }),
  orders: router({
    list: protectedProcedure.query(({ ctx }) => getUserOrders(ctx.user.id, 50)),
    cancel: protectedProcedure.input(z.object({ orderId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour annuler un ordre." });
      const order = (await db.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.userId, ctx.user.id))).limit(1))[0];
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Ordre introuvable." });
      if (order.status !== "pending_approval" && order.status !== "submitted") throw new TRPCError({ code: "BAD_REQUEST", message: "Seuls les ordres en attente peuvent être annulés." });
      const instrument = (await db.select().from(instruments).where(eq(instruments.id, order.instrumentId)).limit(1))[0];
      if (!instrument) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument introuvable." });
      const notional = Number(order.limitPrice ?? instrument.price) * Number(order.quantity);
      const wallet = await ensureWallet(ctx.user.id, instrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH");
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Portefeuille indisponible." });
      await db.transaction(async tx => {
        await tx.update(orders).set({ status: "cancelled", rejectionReason: "Annulé par le client", updatedAt: new Date() }).where(eq(orders.id, order.id));
        if (order.side === "buy") await tx.update(wallets).set({ availableBalance: sql`${wallets.availableBalance} + ${notional}`, pendingBalance: sql`GREATEST(${wallets.pendingBalance} - ${notional}, 0)` }).where(eq(wallets.id, wallet.id));
        await tx.insert(notifications).values({ userId: ctx.user.id, type: "order", title: "Ordre annulé", message: `${order.quantity} ${instrument.symbol} · ${notional} ${instrument.quoteCurrency} libérés.` });
      });
      await writeAuditLog({ actorUserId: ctx.user.id, action: "order.pending_approval_cancelled", entityType: "order", entityId: String(order.id), metadata: { notional, currency: instrument.quoteCurrency } });
      return { success: true as const };
    }),
    placeSpot: protectedProcedure.input(z.object({ instrumentId: z.number().int().positive(), symbol: z.string().min(1), side: z.enum(["buy", "sell"]), orderType: z.enum(["market", "limit", "stop"]).default("market"), quantity: z.number().positive().max(1000000), limitPrice: z.number().positive().optional(), stopLoss: z.number().positive().optional(), takeProfit: z.number().positive().optional(), idempotencyKey: z.string().min(8).max(160).optional() })).mutation(async ({ ctx, input }) => {
      if ((input.orderType === "limit" || input.orderType === "stop") && !input.limitPrice) throw new TRPCError({ code: "BAD_REQUEST", message: "Un prix d’activation est requis pour cet ordre." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour vérifier votre éligibilité et votre solde." });
      if (input.idempotencyKey) { const previous = await getIdempotentResponse(ctx.user.id, input.idempotencyKey, "order.placeSpot"); if (previous) return previous; }
      const instrument = await db.select().from(instruments).where(eq(instruments.id, input.instrumentId)).limit(1);
      const catalogInstrument = instrument[0] ?? pendingActivationInstruments.find(item => item.id === input.instrumentId);
      const price = Number(catalogInstrument?.price ?? 0);
      if (!catalogInstrument || price <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Instrument non disponible." });
      const executionPrice = input.orderType === "market" ? price : Number(input.limitPrice);
      const notional = executionPrice * input.quantity;
      const kyc = await getKycCase(ctx.user.id);
      const wallet = await ensureWallet(ctx.user.id, catalogInstrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH");
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Portefeuille indisponible." });
      const eligibility = evaluateTradingEligibility({ kycStatus: kyc?.status, walletStatus: wallet.status, availableBalance: input.side === "sell" ? Number.MAX_SAFE_INTEGER : Number(wallet.availableBalance), notional });
      if (!eligibility.allowed) throw new TRPCError({ code: eligibility.reason === "kyc_pending" ? "FORBIDDEN" : "BAD_REQUEST", message: eligibility.message });
      const reference = randomReference("ORD");
      const executionMode = resolveTradeExecutionMode(hasConnectedProvider("brokerage"));
      const isMarket = input.orderType === "market";
      const orderId = await db.transaction(async tx => {
        const position = (await tx.select().from(positions).where(and(eq(positions.userId, ctx.user.id), eq(positions.instrumentId, input.instrumentId))).limit(1))[0];
        if (input.side === "sell" && Number(position?.quantity ?? 0) < input.quantity) throw new TRPCError({ code: "BAD_REQUEST", message: "Position insuffisante pour vendre cette quantité." });
        if (isMarket) {
          if (input.side === "buy") {
            const reserved = await tx.update(wallets).set({ availableBalance: sql`${wallets.availableBalance} - ${notional}`, updatedAt: new Date() }).where(and(eq(wallets.id, wallet.id), sql`${wallets.availableBalance} >= ${notional}`));
            if (!reserved[0]?.affectedRows) throw new TRPCError({ code: "BAD_REQUEST", message: "Solde disponible insuffisant pour exécuter cet ordre." });
            const oldQuantity = Number(position?.quantity ?? 0);
            const newQuantity = oldQuantity + input.quantity;
            const averageCost = ((oldQuantity * Number(position?.averageCost ?? 0)) + notional) / newQuantity;
            if (position) await tx.update(positions).set({ quantity: newQuantity.toFixed(8), averageCost: averageCost.toFixed(8), currency: catalogInstrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH", updatedAt: new Date() }).where(eq(positions.id, position.id));
            else await tx.insert(positions).values({ userId: ctx.user.id, instrumentId: input.instrumentId, quantity: input.quantity.toFixed(8), averageCost: executionPrice.toFixed(8), unrealizedPnl: "0", currency: catalogInstrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH", updatedAt: new Date() });
            await tx.insert(walletTransactions).values({ walletId: wallet.id, userId: ctx.user.id, type: "trade_debit", direction: "debit", amount: notional.toFixed(8), currency: catalogInstrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH", status: "completed", reference: `${reference}-DEBIT`, description: `Achat interne ${input.quantity} ${input.symbol} à ${executionPrice}`, completedAt: new Date() });
          } else {
            const released = await tx.update(positions).set({ quantity: sql`${positions.quantity} - ${input.quantity}`, updatedAt: new Date() }).where(and(eq(positions.id, position!.id), sql`${positions.quantity} >= ${input.quantity}`));
            if (!released[0]?.affectedRows) throw new TRPCError({ code: "BAD_REQUEST", message: "Position insuffisante pour vendre cette quantité." });
            await tx.update(wallets).set({ availableBalance: sql`${wallets.availableBalance} + ${notional}`, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
            await tx.insert(walletTransactions).values({ walletId: wallet.id, userId: ctx.user.id, type: "trade_credit", direction: "credit", amount: notional.toFixed(8), currency: catalogInstrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH", status: "completed", reference: `${reference}-CREDIT`, description: `Vente interne ${input.quantity} ${input.symbol} à ${executionPrice}`, completedAt: new Date() });
          }
        } else if (input.side === "buy") {
          const reserved = await tx.update(wallets).set({ availableBalance: sql`${wallets.availableBalance} - ${notional}`, pendingBalance: sql`${wallets.pendingBalance} + ${notional}`, updatedAt: new Date() }).where(and(eq(wallets.id, wallet.id), sql`${wallets.availableBalance} >= ${notional}`));
          if (!reserved[0]?.affectedRows) throw new TRPCError({ code: "BAD_REQUEST", message: "Solde disponible insuffisant pour réserver cet ordre." });
        }
        const inserted = await tx.insert(orders).values({ userId: ctx.user.id, instrumentId: input.instrumentId, side: input.side, orderType: input.orderType, quantity: input.quantity.toFixed(8), limitPrice: input.limitPrice?.toFixed(8), stopLoss: input.stopLoss?.toFixed(8), takeProfit: input.takeProfit?.toFixed(8), marginUsed: notional.toFixed(8), filledQuantity: isMarket ? input.quantity.toFixed(8) : "0", averagePrice: isMarket ? executionPrice.toFixed(8) : null, realizedPnl: null, status: isMarket ? "filled" : "submitted", executionMode, providerReference: isMarket ? `AFRIBROKER-${reference}` : null, createdAt: new Date(), updatedAt: new Date(), executedAt: isMarket ? new Date() : null });
        await tx.insert(notifications).values({ userId: ctx.user.id, type: "order", title: isMarket ? "Ordre exécuté" : "Ordre transmis", message: isMarket ? `${input.side === "buy" ? "Achat" : "Vente"} ${input.quantity} ${input.symbol} · ${notional} ${catalogInstrument.quoteCurrency} exécuté par Africoin.` : `${input.side === "buy" ? "Achat" : "Vente"} ${input.quantity} ${input.symbol} · ordre ${input.orderType === "limit" ? "limite" : "stop"} en attente du cours déclencheur.` });
        return Number(inserted[0].insertId);
      });
      await writeAuditLog({ actorUserId: ctx.user.id, action: isMarket ? "order.filled_internal" : "order.submitted_internal", entityType: "order", entityId: String(orderId), metadata: { symbol: input.symbol, side: input.side, quantity: input.quantity, price: executionPrice, notional, currency: catalogInstrument.quoteCurrency, broker: "africoin_internal" } });
      const response = isMarket
        ? { reference, status: "filled" as const, executionMode, message: "Ordre exécuté par le broker interne Africoin." }
        : { reference, status: "submitted" as const, executionMode, message: "Ordre transmis au broker interne et en attente du cours déclencheur." };
      if (input.idempotencyKey) await saveIdempotentResponse(ctx.user.id, input.idempotencyKey, "order.placeSpot", response);
      return response;
    })
  }),
  wallets: router({
    balances: protectedProcedure.query(({ ctx }) => getUserWallets(ctx.user.id)),
    requestDeposit: protectedProcedure.input(z.object({ amount: z.number().positive(), currency: z.enum(["CDF", "USD"]), method: z.enum(["bank_transfer", "mobile_money", "card", "partner"]), idempotencyKey: z.string().min(8).max(160).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour soumettre un financement." });
      if (input.idempotencyKey) { const previous = await getIdempotentResponse(ctx.user.id, input.idempotencyKey, "wallet.deposit"); if (previous) return previous; }
      const reference = randomReference("DEP");
      const wallet = await ensureWallet(ctx.user.id, input.currency);
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Portefeuille indisponible." });
      await db.insert(depositRequests).values({ userId: ctx.user.id, walletId: wallet.id, amount: input.amount.toFixed(8), currency: input.currency, method: input.method, reference, status: "requested" });
      await db.insert(reconciliationRecords).values({ requestReference: reference, entityType: "deposit", expectedAmount: input.amount.toFixed(8), currency: input.currency, status: "unmatched" }); await db.insert(reconciliationHistory).values({ requestReference: reference, entityType: "deposit", expectedAmount: input.amount.toFixed(8), currency: input.currency, status: "unmatched" });
      await db.insert(notifications).values({ userId: ctx.user.id, type: "deposit", title: "Demande de dépôt créée", message: `${input.amount} ${input.currency} · ${reference}` });
      await writeAuditLog({ actorUserId: ctx.user.id, action: "deposit.requested", entityType: "deposit_request", entityId: reference, metadata: { amount: input.amount, currency: input.currency, method: input.method } });
      const response = { reference, status: "requested" as const, mode: "pending_activation" as const, message: "Demande créée. Elle sera créditée uniquement après approbation de l’administrateur et confirmation du règlement." };
      if (input.idempotencyKey) await saveIdempotentResponse(ctx.user.id, input.idempotencyKey, "wallet.deposit", response);
      return response;
    }),
    requestWithdrawal: protectedProcedure.input(z.object({ amount: z.number().positive(), currency: z.enum(["CDF", "USD"]), destinationType: z.enum(["bank_account", "mobile_money", "partner"]), idempotencyKey: z.string().min(8).max(160).optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (db && input.idempotencyKey) { const previous = await getIdempotentResponse(ctx.user.id, input.idempotencyKey, "wallet.withdrawal"); if (previous) return previous; }
      const reference = randomReference("WDL");
      if (!hasConnectedProvider("payments")) return { reference, status: "pending_review", mode: "pending_activation", message: "Retrait enregistré en attente de contrôle conformité." };
      if (!db) return { reference, status: "pending_review", mode: "pending_activation", message: "Retrait enregistré en attente de contrôle conformité." };
      const wallet = await ensureWallet(ctx.user.id, input.currency);
      if (!wallet) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Portefeuille indisponible." });
      if (Number(wallet.availableBalance) < input.amount) throw new TRPCError({ code: "BAD_REQUEST", message: "Solde disponible insuffisant." });
      const limit = await getOrCreateRiskLimit(ctx.user.id);
      if (limit?.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Votre portefeuille est restreint par la conformité." });
      if (Number(limit.dailyWithdrawalLimit) < input.amount) throw new TRPCError({ code: "BAD_REQUEST", message: "La limite de retrait autorisée est dépassée." });
      await db.insert(withdrawalRequests).values({ userId: ctx.user.id, walletId: wallet.id, amount: input.amount.toFixed(8), currency: input.currency, destinationType: input.destinationType, reference, status: "pending_review" });
      await db.insert(reconciliationRecords).values({ requestReference: reference, entityType: "withdrawal", expectedAmount: input.amount.toFixed(8), currency: input.currency, status: "unmatched" }); await db.insert(reconciliationHistory).values({ requestReference: reference, entityType: "withdrawal", expectedAmount: input.amount.toFixed(8), currency: input.currency, status: "unmatched" });
      await db.insert(notifications).values({ userId: ctx.user.id, type: "withdrawal", title: "Demande de retrait soumise", message: `${input.amount} ${input.currency} · contrôle conformité en attente.` });
      await writeAuditLog({ actorUserId: ctx.user.id, action: "withdrawal.requested", entityType: "withdrawal_request", entityId: reference, severity: "warning", metadata: { amount: input.amount, currency: input.currency } });
      const response = { reference, status: "pending_review" as const, mode: "pending_activation" as const, message: "Retrait soumis au contrôle conformité; le paiement sera déclenché après validation du partenaire agréé." };
      if (input.idempotencyKey) await saveIdempotentResponse(ctx.user.id, input.idempotencyKey, "wallet.withdrawal", response);
      return response;
    }),
  }),
  adminFunding: router({
    queue: permissionProcedure("funding.review").query(async () => { const db = await getDb(); if (!db) return { deposits: [], withdrawals: [], totals: { pending: 0, deposits: 0, withdrawals: 0 } }; const [deposits, withdrawals] = await Promise.all([db.select().from(depositRequests).where(inArray(depositRequests.status, ["requested", "pending_review", "processing"])).orderBy(desc(depositRequests.createdAt)).limit(200), db.select().from(withdrawalRequests).where(inArray(withdrawalRequests.status, ["requested", "pending_review", "processing"])).orderBy(desc(withdrawalRequests.createdAt)).limit(200)]); const requests = [...deposits, ...withdrawals]; const userIds = Array.from(new Set(requests.map(row => row.userId))); const [userRows, profileRows, kycRows, limitRows, alertRows, walletRows, auditRows, notificationRows, reconRows, reconHistoryRows] = await Promise.all([userIds.length ? db.select().from(users).where(inArray(users.id, userIds)) : [], userIds.length ? db.select().from(clientProfiles).where(inArray(clientProfiles.userId, userIds)) : [], userIds.length ? db.select().from(kycCases).where(inArray(kycCases.userId, userIds)) : [], userIds.length ? db.select().from(riskLimits).where(inArray(riskLimits.userId, userIds)) : [], userIds.length ? db.select().from(complianceAlerts).where(and(inArray(complianceAlerts.userId, userIds), inArray(complianceAlerts.status, ["open", "investigating"]))) : [], userIds.length ? db.select().from(wallets).where(inArray(wallets.userId, userIds)) : [], requests.length ? db.select().from(auditLogs).where(inArray(auditLogs.entityId, requests.map(row => String(row.id)))).orderBy(desc(auditLogs.createdAt)).limit(100) : [], userIds.length ? db.select().from(notifications).where(inArray(notifications.userId, userIds)).orderBy(desc(notifications.createdAt)).limit(100) : [], requests.length ? db.select().from(reconciliationRecords).where(inArray(reconciliationRecords.requestReference, requests.map(row => row.reference))).orderBy(desc(reconciliationRecords.createdAt)) : [], requests.length ? db.select().from(reconciliationHistory).where(inArray(reconciliationHistory.requestReference, requests.map(row => row.reference))).orderBy(desc(reconciliationHistory.createdAt)) : []]); const enrich = (row: any, kind: "deposit" | "withdrawal") => ({ ...row, user: userRows.find(user => user.id === row.userId) ?? null, profile: profileRows.find(profile => profile.userId === row.userId) ?? null, kyc: kycRows.find(kyc => kyc.userId === row.userId) ?? null, limits: limitRows.find(limit => limit.userId === row.userId) ?? null, alerts: alertRows.filter(alert => alert.userId === row.userId), wallets: walletRows.filter(wallet => wallet.userId === row.userId), reconciliation: reconRows.filter(recon => recon.requestReference === row.reference), reconciliationHistory: reconHistoryRows.filter(recon => recon.requestReference === row.reference), audit: auditRows.filter(log => log.entityId === String(row.id) && log.entityType === `${kind}_request`), notifications: notificationRows.filter(notification => notification.userId === row.userId && notification.message.includes(row.reference)) }); return { deposits: deposits.map(row => enrich(row, "deposit")), withdrawals: withdrawals.map(row => enrich(row, "withdrawal")), totals: { pending: deposits.length + withdrawals.length, deposits: deposits.length, withdrawals: withdrawals.length } }; }),
    decide: permissionProcedure("funding.review").input(z.object({ kind: z.enum(["deposit", "withdrawal"]), id: z.number().int().positive(), decision: z.enum(["approve", "reject"]), note: z.string().min(3).max(500), providerReference: z.string().max(180).optional(), settledAmount: z.number().positive().optional() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour décider un financement." });
      const table = input.kind === "deposit" ? depositRequests : withdrawalRequests;
      const row = (await db.select().from(table).where(eq(table.id, input.id)).limit(1))[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Demande introuvable." });
      if (!["requested", "pending_review", "processing"].includes(row.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Cette demande a déjà été traitée." });
      const settledAmount = input.settledAmount ?? Number(row.amount);
      const status = input.decision === "approve" ? (input.kind === "deposit" ? "completed" : "processing") : "rejected";
      await db.transaction(async tx => {
        await tx.update(table).set({ status, complianceNote: input.note, providerReference: input.providerReference }).where(eq(table.id, input.id));
        await tx.update(reconciliationRecords).set({ status: input.decision === "approve" ? "matched" : "exception", settledAmount: input.decision === "approve" ? settledAmount.toFixed(8) : undefined, providerReference: input.providerReference, reviewNote: input.note, reviewedBy: ctx.user.id }).where(eq(reconciliationRecords.requestReference, row.reference));
        await tx.insert(reconciliationHistory).values({ requestReference: row.reference, entityType: input.kind, expectedAmount: row.amount, settledAmount: input.decision === "approve" ? settledAmount.toFixed(8) : undefined, currency: row.currency, status: input.decision === "approve" ? "matched" : "exception", providerReference: input.providerReference, reviewNote: input.note, reviewedBy: ctx.user.id });
        if (input.kind === "deposit" && input.decision === "approve") {
          await tx.update(wallets).set({ availableBalance: sql`${wallets.availableBalance} + ${settledAmount}` }).where(eq(wallets.id, row.walletId));
          await tx.insert(walletTransactions).values({ walletId: row.walletId, userId: row.userId, type: "deposit", direction: "credit", amount: settledAmount.toFixed(8), currency: row.currency, status: "completed", reference: row.reference, providerReference: input.providerReference, description: "Dépôt approuvé par l’administration", completedAt: new Date() });
        }
        await tx.insert(notifications).values(buildFundingDecisionNotification({ userId: row.userId, type: input.kind, decision: input.decision, reference: row.reference, note: input.note }));
      });
      await writeAuditLog({ actorUserId: ctx.user.id, action: `funding.${input.kind}.${input.decision}`, entityType: `${input.kind}_request`, entityId: String(input.id), severity: input.decision === "reject" ? "warning" : "info", metadata: { note: input.note, providerReference: input.providerReference, settledAmount } });
      return { success: true as const, status };
    }),
  }),
  adminUsers: router({
    list: adminProcedure.input(z.object({ search: z.string().max(120).default(""), role: z.enum(["all", "user", "compliance", "admin", "super_admin"]).default("all"), status: z.enum(["all", "active", "restricted", "blocked"]).default("all"), page: z.number().int().positive().default(1), pageSize: z.number().int().min(5).max(50).default(20) })).query(({ input }) => listAdminUsers(input)),
    detail: adminProcedure.input(z.object({ userId: z.number().int().positive() })).query(({ input }) => getAdminUserDetail(input.userId)),
    reviewKyc: permissionProcedure("kyc.review").input(z.object({ userId: z.number().int().positive(), status: z.enum(["approved", "rejected", "needs_action"]), note: z.string().trim().min(3).max(500) })).mutation(({ ctx, input }) => reviewAdminUserKyc({ actorUserId: ctx.user.id, targetUserId: input.userId, status: input.status, note: input.note })),
    updateStatus: permissionProcedure("user.status").input(z.object({ userId: z.number().int().positive(), status: z.enum(["active", "restricted", "blocked"]), reason: z.string().min(5).max(500) })).mutation(({ ctx, input }) => requestAdminUserStatus({ actorUserId: ctx.user.id, targetUserId: input.userId, status: input.status, reason: input.reason })),
    updateRole: permissionProcedure("user.role").input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "compliance", "admin", "super_admin"]), reason: z.string().min(5).max(500) })).mutation(({ ctx, input }) => requestAdminUserRole({ actorUserId: ctx.user.id, targetUserId: input.userId, role: input.role, reason: input.reason })),
    updateAccount: permissionProcedure("system.manage").input(z.object({ userId: z.number().int().positive(), name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(320), reason: z.string().trim().min(5).max(500) })).mutation(({ ctx, input }) => updateAdminUserAccount({ actorUserId: ctx.user.id, targetUserId: input.userId, name: input.name, email: input.email, reason: input.reason })),
    deleteAccount: permissionProcedure("system.manage").input(z.object({ userId: z.number().int().positive(), reason: z.string().trim().min(5).max(500) })).mutation(({ ctx, input }) => deleteAdminUser({ actorUserId: ctx.user.id, targetUserId: input.userId, reason: input.reason })),
    adjustWallet: permissionProcedure("system.manage").input(z.object({ userId: z.number().int().positive(), currency: z.enum(["CDF", "USD"]), direction: z.enum(["credit", "debit"]), amount: z.number().positive().max(1000000000000), reason: z.string().trim().min(5).max(500) })).mutation(({ ctx, input }) => adjustAdminUserWallet({ actorUserId: ctx.user.id, targetUserId: input.userId, currency: input.currency, direction: input.direction, amount: input.amount, reason: input.reason })),
  }),
  adminApprovals: router({
    list: permissionProcedure("approvals.read").query(() => listApprovalRequests()),
    decide: permissionProcedure("approvals.decide").input(z.object({ requestId: z.number().int().positive(), decision: z.enum(["approve", "reject"]), note: z.string().min(3).max(500).optional() })).mutation(({ ctx, input }) => decideApproval({ requestId: input.requestId, approverUserId: ctx.user.id, approverRole: ctx.user.role, decision: input.decision, note: input.note })),
    request: permissionProcedure("system.manage").input(z.object({ actionType: z.enum(["role_change", "account_status", "limit_update"]), targetUserId: z.number().int().positive(), payload: z.object({ targetUserId: z.number().int().positive(), role: z.enum(["user", "compliance", "admin", "super_admin"]).optional(), status: z.enum(["active", "restricted", "blocked"]).optional(), dailyDepositLimit: z.number().positive().optional(), dailyWithdrawalLimit: z.number().positive().optional(), orderNotionalLimit: z.number().positive().optional() }), reason: z.string().min(5).max(500) })).mutation(({ ctx, input }) => createApprovalRequest({ actionType: input.actionType, requesterUserId: ctx.user.id, targetUserId: input.targetUserId, payload: input.payload, reason: input.reason })),
  }),
  adminMarkets: router({
    list: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return pendingActivationInstruments;
      const rows = await db.select().from(instruments).orderBy(instruments.assetClass, instruments.symbol);
      return rows.length ? rows : pendingActivationInstruments;
    }),
    createInstrument: adminProcedure.input(z.object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,16}$/), name: z.string().trim().min(3).max(160), assetClass: z.enum(["fx_spot", "index"]), exchange: z.string().trim().min(2).max(80), baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), quoteCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/), price: z.number().positive().max(1000000000000), changePercent: z.number().min(-100).max(100).optional() })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "super_admin") throw new TRPCError({ code: "FORBIDDEN", message: "Seul le super administrateur peut créer un nouvel instrument." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour créer un instrument." });
      const existing = (await db.select().from(instruments).where(eq(instruments.symbol, input.symbol)).limit(1))[0];
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Ce symbole existe déjà dans le catalogue." });
      const inserted = await db.insert(instruments).values({ symbol: input.symbol, name: input.name, assetClass: input.assetClass, exchange: input.exchange, baseCurrency: input.baseCurrency, quoteCurrency: input.quoteCurrency, price: input.price.toFixed(8), changePercent: (input.changePercent ?? 0).toFixed(4), status: "active", riskLevel: "medium", provider: "africoin_internal", updatedAt: new Date() });
      const instrumentId = Number(inserted[0].insertId);
      await writeAuditLog({ actorUserId: ctx.user.id, action: "market.instrument_created", entityType: "instrument", entityId: String(instrumentId), metadata: { ...input, provider: "africoin_internal" } });
      return (await db.select().from(instruments).where(eq(instruments.id, instrumentId)).limit(1))[0];
    }),
    updateRate: adminProcedure.input(z.object({ instrumentId: z.number().int().positive(), price: z.number().positive().max(1000000000000), changePercent: z.number().min(-100).max(100).optional(), status: z.enum(["active", "disabled", "pending_approval"]).optional(), note: z.string().trim().min(3).max(300) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour modifier un taux administré." });
      const current = (await db.select().from(instruments).where(eq(instruments.id, input.instrumentId)).limit(1))[0];
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument introuvable." });
      await db.update(instruments).set({ price: input.price.toFixed(8), changePercent: input.changePercent?.toFixed(4) ?? current.changePercent, status: input.status ?? current.status }).where(eq(instruments.id, input.instrumentId));
      await writeAuditLog({ actorUserId: ctx.user.id, action: "market.instrument_rate_updated", entityType: "instrument", entityId: String(input.instrumentId), metadata: { symbol: current.symbol, price: input.price, changePercent: input.changePercent, status: input.status, note: input.note } });
      return (await db.select().from(instruments).where(eq(instruments.id, input.instrumentId)).limit(1))[0];
    }),
  }),
  compliance: router({
    queue: requireCompliance.query(() => getComplianceQueue()),
    kycDocuments: requireCompliance.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const cases = await db.select().from(kycCases).orderBy(desc(kycCases.updatedAt)).limit(100);
      const userIds = Array.from(new Set(cases.map(item => item.userId)));
      const [usersRows, documents] = await Promise.all([
        userIds.length ? db.select().from(users).where(inArray(users.id, userIds)) : [],
        cases.length ? db.select().from(kycDocuments).where(inArray(kycDocuments.kycCaseId, cases.map(item => item.id))).orderBy(desc(kycDocuments.createdAt)) : [],
      ]);
      return Promise.all(cases.map(async item => ({
        ...item,
        user: usersRows.find(user => user.id === item.userId) ?? null,
        documents: await Promise.all(documents.filter(document => document.kycCaseId === item.id).map(async document => ({ ...document, url: await storageGetSignedUrl(document.storageKey).catch(() => null) }))),
      })));
    }),
    reviewDocument: requireCompliance.input(z.object({ documentId: z.number().int().positive(), status: z.enum(["accepted", "rejected"]), note: z.string().trim().min(3).max(500) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour revoir un document." });
      const document = (await db.select().from(kycDocuments).where(eq(kycDocuments.id, input.documentId)).limit(1))[0];
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document KYC introuvable." });
      const currentCase = (await db.select().from(kycCases).where(eq(kycCases.id, document.kycCaseId)).limit(1))[0];
      if (!currentCase) throw new TRPCError({ code: "NOT_FOUND", message: "Dossier KYC introuvable." });
      await db.update(kycDocuments).set({ status: input.status, reviewerNote: input.note }).where(eq(kycDocuments.id, input.documentId));
      await db.update(kycCases).set({ status: input.status === "rejected" ? "needs_action" : "in_review", reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note }).where(eq(kycCases.id, document.kycCaseId));
      await db.insert(notifications).values({ userId: currentCase.userId, type: "kyc", title: input.status === "accepted" ? "Document KYC accepté" : "Document KYC à remplacer", message: input.note });
      await writeAuditLog({ actorUserId: ctx.user.id, action: `kyc.document_${input.status}`, entityType: "kyc_document", entityId: String(input.documentId), metadata: { caseId: document.kycCaseId, note: input.note } });
      return { success: true as const, status: input.status };
    }),
    reconcile: requireCompliance.input(z.object({ id: z.number().int().positive(), status: z.enum(["matched", "exception", "resolved"]), settledAmount: z.number().nonnegative().optional(), providerReference: z.string().max(180).optional(), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => { const db = await getDb(); if (db) { const current = (await db.select().from(reconciliationRecords).where(eq(reconciliationRecords.id, input.id)).limit(1))[0]; if (current) await db.insert(reconciliationHistory).values({ requestReference: current.requestReference, entityType: current.entityType === "withdrawal" ? "withdrawal" : "deposit", expectedAmount: current.expectedAmount, settledAmount: input.settledAmount?.toFixed(8), currency: current.currency, status: input.status, providerReference: input.providerReference, reviewNote: input.note, reviewedBy: ctx.user.id }); await db.update(reconciliationRecords).set({ status: input.status, settledAmount: input.settledAmount?.toFixed(8), providerReference: input.providerReference, reviewNote: input.note, reviewedBy: ctx.user.id }).where(eq(reconciliationRecords.id, input.id)); } await writeAuditLog({ actorUserId: ctx.user.id, action: `reconciliation.${input.status}`, entityType: "reconciliation_record", entityId: String(input.id), metadata: { providerReference: input.providerReference } }); return { success: true }; }),
    reconciliation: requireCompliance.query(() => getReconciliationQueue()),
    limits: requireCompliance.input(z.object({ userId: z.number().int().positive() })).query(({ input }) => getOrCreateRiskLimit(input.userId)),
    updateLimits: requireCompliance.input(z.object({ userId: z.number().int().positive(), dailyDepositLimit: z.number().positive(), dailyWithdrawalLimit: z.number().positive(), orderNotionalLimit: z.number().positive(), status: z.enum(["active", "restricted", "blocked"]) })).mutation(({ ctx, input }) => createApprovalRequest({ actionType: "limit_update", requesterUserId: ctx.user.id, targetUserId: input.userId, payload: { targetUserId: input.userId, dailyDepositLimit: input.dailyDepositLimit, dailyWithdrawalLimit: input.dailyWithdrawalLimit, orderNotionalLimit: input.orderNotionalLimit, status: input.status }, reason: "Mise à jour des limites demandée depuis la conformité" })),
    audit: requireCompliance.query(() => getAuditLogs(100)),
    blockUser: requireCompliance.input(z.object({ userId: z.number().int().positive(), reason: z.string().min(5) })).mutation(({ ctx, input }) => createApprovalRequest({ actionType: "account_status", requesterUserId: ctx.user.id, targetUserId: input.userId, payload: { targetUserId: input.userId, status: "blocked" }, reason: input.reason })),
    resolveAlert: requireCompliance.input(z.object({ alertId: z.number().int().positive(), status: z.enum(["resolved", "dismissed"]), note: z.string().min(3) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (db) await db.update(complianceAlerts).set({ status: input.status, resolutionNote: input.note, assignedTo: ctx.user.id }).where(eq(complianceAlerts.id, input.alertId));
      await writeAuditLog({ actorUserId: ctx.user.id, action: `compliance.alert_${input.status}`, entityType: "compliance_alert", entityId: String(input.alertId), metadata: { note: input.note } });
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
