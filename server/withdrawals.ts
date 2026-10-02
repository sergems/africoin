import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { kycCases, notifications, reconciliationHistory, reconciliationRecords, riskLimits, users, wallets, withdrawalRequests } from "../drizzle/schema";
import { buildFundingDecisionNotification, buildWithdrawalRequestNotification } from "./notificationService";
import { getDb, getIdempotentResponse, getOrCreateRiskLimit, saveIdempotentResponse, writeAuditLog } from "./db";

const randomReference = () => `WDL-${nanoid(12).toUpperCase()}`;
const openWithdrawalStatuses = ["requested", "pending_review", "approved_pending_payout", "processing"] as const;
const dailyWithdrawalStatuses = [...openWithdrawalStatuses, "completed"] as const;

export function isWithdrawalAwaitingAdminReview(status: string) {
  return status === "requested" || status === "pending_review";
}

export function resolveWithdrawalDecisionStatus(decision: "approve" | "reject") {
  return decision === "approve" ? "approved_pending_payout" as const : "rejected" as const;
}

export async function createWithdrawalRequest(input: {
  userId: number;
  amount: number;
  currency: "CDF" | "USD";
  destinationType: "bank_account" | "mobile_money" | "partner";
  idempotencyKey?: string;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour soumettre un retrait." });

  if (input.idempotencyKey) {
    const previous = await getIdempotentResponse(input.userId, input.idempotencyKey, "wallet.withdrawal");
    if (previous) return previous;
  }

  const reference = input.idempotencyKey
    ? `WDL-${createHash("sha256").update(`${input.userId}:${input.idempotencyKey}`).digest("hex").slice(0, 32).toUpperCase()}`
    : randomReference();
  const existing = (await db.select().from(withdrawalRequests).where(and(
    eq(withdrawalRequests.reference, reference),
    eq(withdrawalRequests.userId, input.userId),
  )).limit(1))[0];
  if (existing) {
    return { reference, status: existing.status, message: "Cette demande existe déjà; elle reste soumise à l’approbation administrative." };
  }

  const initialRiskLimit = await getOrCreateRiskLimit(input.userId);
  if (!initialRiskLimit) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Les limites de conformité sont indisponibles." });

  const outcome = await db.transaction(async tx => {
    const lockedUser = (await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update"))[0];
    if (!lockedUser) throw new TRPCError({ code: "NOT_FOUND", message: "Compte introuvable." });

    const concurrentRequest = (await tx.select().from(withdrawalRequests).where(and(
      eq(withdrawalRequests.reference, reference),
      eq(withdrawalRequests.userId, input.userId),
    )).limit(1))[0];
    if (concurrentRequest) return { existing: concurrentRequest };

    const kyc = (await tx.select().from(kycCases).where(eq(kycCases.userId, input.userId)).orderBy(desc(kycCases.updatedAt)).limit(1).for("update"))[0];
    if (kyc?.status !== "approved") throw new TRPCError({ code: "FORBIDDEN", message: "La validation KYC est requise avant toute demande de retrait." });

    const limits = (await tx.select().from(riskLimits).where(eq(riskLimits.userId, input.userId)).limit(1).for("update"))[0];
    if (!limits || limits.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Votre compte est restreint par la conformité." });

    const wallet = (await tx.select().from(wallets).where(and(
      eq(wallets.userId, input.userId),
      eq(wallets.currency, input.currency),
    )).limit(1).for("update"))[0];
    if (!wallet || wallet.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Portefeuille indisponible ou restreint." });

    const amount = input.amount;
    const availableBalance = Number(wallet.availableBalance);
    if (amount > availableBalance) throw new TRPCError({ code: "BAD_REQUEST", message: "Le solde disponible est insuffisant pour cette demande." });

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todaysWithdrawals = await tx.select({ amount: withdrawalRequests.amount }).from(withdrawalRequests).where(and(
      eq(withdrawalRequests.userId, input.userId),
      eq(withdrawalRequests.currency, input.currency),
      gte(withdrawalRequests.createdAt, startOfDay),
      inArray(withdrawalRequests.status, [...dailyWithdrawalStatuses]),
    ));
    const totalToday = todaysWithdrawals.reduce((sum, row) => sum + Number(row.amount), 0);
    if (totalToday + amount > Number(limits.dailyWithdrawalLimit)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "La limite quotidienne de retrait autorisée serait dépassée." });
    }

    const openWithdrawals = await tx.select({ amount: withdrawalRequests.amount }).from(withdrawalRequests).where(and(
      eq(withdrawalRequests.userId, input.userId),
      eq(withdrawalRequests.walletId, wallet.id),
      inArray(withdrawalRequests.status, [...openWithdrawalStatuses]),
    ));
    const totalOpen = openWithdrawals.reduce((sum, row) => sum + Number(row.amount), 0);
    if (totalOpen + amount > availableBalance) {
      throw new TRPCError({ code: "CONFLICT", message: "Les demandes de retrait en attente dépasseraient le solde disponible." });
    }

    const inserted = await tx.insert(withdrawalRequests).values({
      userId: input.userId,
      walletId: wallet.id,
      amount: amount.toFixed(8),
      currency: input.currency,
      destinationType: input.destinationType,
      status: "pending_review",
      reference,
      complianceNote: "En attente d’approbation administrative; aucun fonds n’est réservé et aucun payout n’est envoyé.",
    });
    await tx.insert(reconciliationRecords).values({
      requestReference: reference,
      entityType: "withdrawal",
      expectedAmount: amount.toFixed(8),
      currency: input.currency,
      status: "unmatched",
      reviewNote: "Retrait soumis; approbation administrative requise. Aucun payout soumis.",
    });
    await tx.insert(reconciliationHistory).values({
      requestReference: reference,
      entityType: "withdrawal",
      expectedAmount: amount.toFixed(8),
      currency: input.currency,
      status: "unmatched",
      reviewNote: "Retrait soumis; en attente d’approbation administrative. Aucun solde modifié.",
    });
    await tx.insert(notifications).values(buildWithdrawalRequestNotification({
      userId: input.userId,
      reference,
      amount: amount.toFixed(2),
      currency: input.currency,
    }));
    return { existing: null, requestId: Number(inserted[0].insertId) };
  });

  if (outcome.existing) {
    return { reference, status: outcome.existing.status, message: "Cette demande existe déjà; elle reste soumise à l’approbation administrative." };
  }

  await writeAuditLog({
    actorUserId: input.userId,
    action: "withdrawal.requested",
    entityType: "withdrawal_request",
    entityId: String(outcome.requestId),
    metadata: { amount: input.amount, currency: input.currency, destinationType: input.destinationType, approvalRequired: true, payoutEnabled: false },
  });

  const response = {
    reference,
    status: "pending_review" as const,
    message: "Demande enregistrée en attente d’approbation d’un administrateur ou Super Admin. Aucun fonds n’a été réservé ni transféré.",
  };
  if (input.idempotencyKey) await saveIdempotentResponse(input.userId, input.idempotencyKey, "wallet.withdrawal", response);
  return response;
}

export async function decideWithdrawalRequest(input: {
  actorUserId: number;
  id: number;
  decision: "approve" | "reject";
  note: string;
  providerReference?: string;
  settledAmount?: number;
}) {
  if (input.providerReference || input.settledAmount !== undefined) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Les transferts de retrait sont désactivés; aucune référence partenaire ni somme réglée ne peut être enregistrée." });
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour décider un retrait." });

  const result = await db.transaction(async tx => {
    const row = (await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, input.id)).limit(1).for("update"))[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Demande de retrait introuvable." });
    if (!isWithdrawalAwaitingAdminReview(row.status)) {
      throw new TRPCError({ code: "CONFLICT", message: "Cette demande de retrait a déjà reçu une décision." });
    }

    const status = resolveWithdrawalDecisionStatus(input.decision);
    const systemNote = input.decision === "approve"
      ? `${input.note}\nApprobation administrative enregistrée. Aucun fonds n’a été réservé ni transféré; le payout Keccel reste désactivé.`
      : input.note;
    const changed = await tx.update(withdrawalRequests).set({
      status,
      complianceNote: systemNote,
      providerReference: null,
    }).where(and(
      eq(withdrawalRequests.id, row.id),
      inArray(withdrawalRequests.status, ["requested", "pending_review"]),
    ));
    if (!changed[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "La demande a déjà été traitée." });

    const reconciliationStatus = input.decision === "approve" ? "unmatched" as const : "exception" as const;
    const reconciliationNote = input.decision === "approve"
      ? "Approbation administrative uniquement; aucun payout envoyé, aucun solde réservé ou modifié."
      : input.note;
    await tx.update(reconciliationRecords).set({
      status: reconciliationStatus,
      settledAmount: null,
      providerReference: null,
      reviewNote: reconciliationNote,
      reviewedBy: input.actorUserId,
    }).where(eq(reconciliationRecords.requestReference, row.reference));
    await tx.insert(reconciliationHistory).values({
      requestReference: row.reference,
      entityType: "withdrawal",
      expectedAmount: row.amount,
      currency: row.currency,
      status: reconciliationStatus,
      reviewNote: reconciliationNote,
      reviewedBy: input.actorUserId,
    });
    await tx.insert(notifications).values(buildFundingDecisionNotification({
      userId: row.userId,
      type: "withdrawal",
      decision: input.decision,
      reference: row.reference,
      note: input.note,
    }));
    return { status, userId: row.userId, reference: row.reference };
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: `funding.withdrawal.${input.decision}`,
    entityType: "withdrawal_request",
    entityId: String(input.id),
    severity: input.decision === "reject" ? "warning" : "info",
    metadata: { note: input.note, status: result.status, payoutEnabled: false, balanceChanged: false },
  });
  return { success: true as const, status: result.status };
}
