import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  africoinFeeTransactions,
  kycCases,
  kycDocuments,
  notifications,
  reconciliationHistory,
  reconciliationRecords,
  riskLimits,
  users,
  walletTransactions,
  wallets,
  withdrawalRequests,
} from "../drizzle/schema";
import {
  buildFundingDecisionNotification,
  buildWithdrawalCancelledNotification,
  buildWithdrawalRequestNotification,
} from "./notificationService";
import { getDb, getIdempotentResponse, getOrCreateRiskLimit, saveIdempotentResponse, writeAuditLog } from "./db";
import {
  calculateWithdrawalAmounts,
  describeWithdrawalEligibility,
  evaluateWithdrawalEligibility,
  WITHDRAWAL_FEE_RATE,
} from "./withdrawalPolicy";

const randomReference = () => `WDL-${nanoid(12).toUpperCase()}`;
const unreservedOpenWithdrawalStatuses = ["requested", "pending_review", "processing"] as const;
const dailyWithdrawalStatuses = ["requested", "pending_review", "processing", "approved_pending_payout", "completed"] as const;

type WithdrawalCurrency = "CDF" | "USD";

export function isWithdrawalAwaitingAdminReview(status: string) {
  return status === "requested" || status === "pending_review";
}

export function resolveWithdrawalDecisionStatus(decision: "approve" | "reject") {
  return decision === "approve" ? "approved_pending_payout" as const : "rejected" as const;
}

export async function getWithdrawalEligibility(userId: number, currency: WithdrawalCurrency) {
  const db = await getDb();
  if (!db) {
    return {
      eligible: false as const,
      reason: "account_restricted" as const,
      missingDocuments: [] as const,
      message: "Les contrôles de conformité sont indisponibles.",
    };
  }

  const [kyc, limits, wallet] = await Promise.all([
    db.select().from(kycCases).where(eq(kycCases.userId, userId)).orderBy(desc(kycCases.updatedAt)).limit(1).then(rows => rows[0]),
    getOrCreateRiskLimit(userId),
    db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.currency, currency))).limit(1).then(rows => rows[0]),
  ]);
  const documents = kyc
    ? await db.select({ documentType: kycDocuments.documentType, status: kycDocuments.status })
      .from(kycDocuments)
      .where(eq(kycDocuments.kycCaseId, kyc.id))
      .orderBy(desc(kycDocuments.createdAt), desc(kycDocuments.id))
    : [];
  const result = evaluateWithdrawalEligibility({
    kycStatus: kyc?.status,
    documents,
    riskStatus: limits?.status,
    walletStatus: wallet?.status,
  });
  return { ...result, message: describeWithdrawalEligibility(result) };
}

export async function createWithdrawalRequest(input: {
  userId: number;
  amount: number;
  currency: WithdrawalCurrency;
  destinationType: "bank_account" | "mobile_money" | "partner";
  idempotencyKey?: string;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour soumettre un retrait." });

  if (input.idempotencyKey) {
    const previous = await getIdempotentResponse(input.userId, input.idempotencyKey, "wallet.withdrawal");
    if (previous) return previous;
  }

  let amounts: ReturnType<typeof calculateWithdrawalAmounts>;
  try {
    amounts = calculateWithdrawalAmounts(input.amount);
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Montant de retrait invalide." });
  }
  const reference = input.idempotencyKey
    ? `WDL-${createHash("sha256").update(`${input.userId}:${input.idempotencyKey}`).digest("hex").slice(0, 32).toUpperCase()}`
    : randomReference();
  const existing = (await db.select().from(withdrawalRequests).where(and(
    eq(withdrawalRequests.reference, reference),
    eq(withdrawalRequests.userId, input.userId),
  )).limit(1))[0];
  if (existing) {
    return {
      reference,
      status: existing.status,
      totalDebit: existing.amount,
      feeAmount: existing.feeAmount,
      payoutAmount: existing.payoutAmount,
      message: "Cette demande existe déjà; son état et son montant ont été conservés.",
    };
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

    const kyc = (await tx.select().from(kycCases)
      .where(eq(kycCases.userId, input.userId))
      .orderBy(desc(kycCases.updatedAt)).limit(1).for("update"))[0];
    const limits = (await tx.select().from(riskLimits).where(eq(riskLimits.userId, input.userId)).limit(1).for("update"))[0];
    const wallet = (await tx.select().from(wallets).where(and(
      eq(wallets.userId, input.userId),
      eq(wallets.currency, input.currency),
    )).limit(1).for("update"))[0];
    const documents = kyc
      ? await tx.select({ documentType: kycDocuments.documentType, status: kycDocuments.status })
        .from(kycDocuments)
        .where(eq(kycDocuments.kycCaseId, kyc.id))
        .orderBy(desc(kycDocuments.createdAt), desc(kycDocuments.id))
        .for("update")
      : [];
    const eligibility = evaluateWithdrawalEligibility({
      kycStatus: kyc?.status,
      documents,
      riskStatus: limits?.status,
      walletStatus: wallet?.status,
    });
    if (!eligibility.eligible) throw new TRPCError({ code: "FORBIDDEN", message: describeWithdrawalEligibility(eligibility) });
    if (!wallet) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Portefeuille indisponible ou restreint." });

    const totalDebit = Number(amounts.totalDebit);
    const availableBalance = Number(wallet.availableBalance);
    if (totalDebit > availableBalance) throw new TRPCError({ code: "BAD_REQUEST", message: "Le solde disponible est insuffisant pour cette demande." });

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todaysWithdrawals = await tx.select({ amount: withdrawalRequests.amount }).from(withdrawalRequests).where(and(
      eq(withdrawalRequests.userId, input.userId),
      eq(withdrawalRequests.currency, input.currency),
      gte(withdrawalRequests.createdAt, startOfDay),
      inArray(withdrawalRequests.status, [...dailyWithdrawalStatuses]),
    ));
    const totalToday = todaysWithdrawals.reduce((sum, row) => sum + Number(row.amount), 0);
    if (totalToday + totalDebit > Number(limits?.dailyWithdrawalLimit ?? 0)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "La limite quotidienne de retrait autorisée serait dépassée." });
    }

    const unreservedRequests = await tx.select({ amount: withdrawalRequests.amount }).from(withdrawalRequests).where(and(
      eq(withdrawalRequests.userId, input.userId),
      eq(withdrawalRequests.walletId, wallet.id),
      inArray(withdrawalRequests.status, [...unreservedOpenWithdrawalStatuses]),
    ));
    const totalUnreserved = unreservedRequests.reduce((sum, row) => sum + Number(row.amount), 0);
    if (totalUnreserved + totalDebit > availableBalance) {
      throw new TRPCError({ code: "CONFLICT", message: "Les demandes de retrait en attente dépasseraient le solde disponible." });
    }

    const inserted = await tx.insert(withdrawalRequests).values({
      userId: input.userId,
      walletId: wallet.id,
      amount: amounts.totalDebit,
      feeAmount: amounts.feeAmount,
      payoutAmount: amounts.payoutAmount,
      currency: input.currency,
      destinationType: input.destinationType,
      status: "pending_review",
      reference,
      complianceNote: "En attente de décision Africoin; frais estimés à 2,5 %. Aucun fonds n’est réservé avant l’approbation.",
    });
    await tx.insert(reconciliationRecords).values({
      requestReference: reference,
      entityType: "withdrawal",
      expectedAmount: amounts.payoutAmount,
      currency: input.currency,
      status: "unmatched",
      reviewNote: `Retrait soumis · débit total ${amounts.totalDebit} ${input.currency} · frais ${amounts.feeAmount} · versement attendu ${amounts.payoutAmount}.`,
    });
    await tx.insert(reconciliationHistory).values({
      requestReference: reference,
      entityType: "withdrawal",
      expectedAmount: amounts.payoutAmount,
      currency: input.currency,
      status: "unmatched",
      reviewNote: "Retrait soumis; le solde reste disponible jusqu’à la décision d’Africoin.",
    });
    await tx.insert(notifications).values(buildWithdrawalRequestNotification({
      userId: input.userId,
      reference,
      amount: amounts.totalDebit,
      feeAmount: amounts.feeAmount,
      payoutAmount: amounts.payoutAmount,
      currency: input.currency,
    }));
    return { existing: null, requestId: Number(inserted[0].insertId) };
  });

  if (outcome.existing) {
    return {
      reference,
      status: outcome.existing.status,
      totalDebit: outcome.existing.amount,
      feeAmount: outcome.existing.feeAmount,
      payoutAmount: outcome.existing.payoutAmount,
      message: "Cette demande existe déjà; son état et son montant ont été conservés.",
    };
  }

  await writeAuditLog({
    actorUserId: input.userId,
    action: "withdrawal.requested",
    entityType: "withdrawal_request",
    entityId: String(outcome.requestId),
    metadata: {
      totalDebit: amounts.totalDebit,
      feeAmount: amounts.feeAmount,
      payoutAmount: amounts.payoutAmount,
      feeRate: WITHDRAWAL_FEE_RATE,
      currency: input.currency,
      destinationType: input.destinationType,
      approvalRequired: true,
      payoutAutomaticallyEnabled: false,
    },
  });

  const response = {
    reference,
    status: "pending_review" as const,
    totalDebit: amounts.totalDebit,
    feeAmount: amounts.feeAmount,
    payoutAmount: amounts.payoutAmount,
    message: "Demande enregistrée. Le montant sera réservé à l’approbation; le paiement externe reste manuel.",
  };
  if (input.idempotencyKey) await saveIdempotentResponse(input.userId, input.idempotencyKey, "wallet.withdrawal", response);
  return response;
}

export async function decideWithdrawalRequest(input: {
  actorUserId: number;
  id: number;
  decision: "approve" | "reject";
  note: string;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour décider un retrait." });

  const result = await db.transaction(async tx => {
    const row = (await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, input.id)).limit(1).for("update"))[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Demande de retrait introuvable." });
    if (!isWithdrawalAwaitingAdminReview(row.status)) {
      throw new TRPCError({ code: "CONFLICT", message: "Cette demande de retrait a déjà reçu une décision." });
    }

    const status = resolveWithdrawalDecisionStatus(input.decision);
    let reserved = false;
    if (input.decision === "approve") {
      const kyc = (await tx.select().from(kycCases).where(eq(kycCases.userId, row.userId)).orderBy(desc(kycCases.updatedAt)).limit(1).for("update"))[0];
      const limits = (await tx.select().from(riskLimits).where(eq(riskLimits.userId, row.userId)).limit(1).for("update"))[0];
      const wallet = (await tx.select().from(wallets).where(eq(wallets.id, row.walletId)).limit(1).for("update"))[0];
      const documents = kyc
        ? await tx.select({ documentType: kycDocuments.documentType, status: kycDocuments.status })
          .from(kycDocuments)
          .where(eq(kycDocuments.kycCaseId, kyc.id))
          .orderBy(desc(kycDocuments.createdAt), desc(kycDocuments.id))
          .for("update")
        : [];
      const eligibility = evaluateWithdrawalEligibility({
        kycStatus: kyc?.status,
        documents,
        riskStatus: limits?.status,
        walletStatus: wallet?.status,
      });
      if (!eligibility.eligible) {
        throw new TRPCError({ code: "FORBIDDEN", message: `Le retrait ne peut pas être approuvé. ${describeWithdrawalEligibility(eligibility)}` });
      }
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const todaysWithdrawals = await tx.select({ amount: withdrawalRequests.amount }).from(withdrawalRequests).where(and(
        eq(withdrawalRequests.userId, row.userId),
        eq(withdrawalRequests.currency, row.currency),
        gte(withdrawalRequests.createdAt, startOfDay),
        inArray(withdrawalRequests.status, [...dailyWithdrawalStatuses]),
      ));
      const totalToday = todaysWithdrawals.reduce((sum, request) => sum + Number(request.amount), 0);
      if (totalToday > Number(limits?.dailyWithdrawalLimit ?? 0)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "La limite quotidienne de retrait autorisée serait dépassée." });
      }
      const hold = await tx.update(wallets).set({
        availableBalance: sql`${wallets.availableBalance} - ${row.amount}`,
        pendingBalance: sql`${wallets.pendingBalance} + ${row.amount}`,
        updatedAt: new Date(),
      }).where(and(
        eq(wallets.id, row.walletId),
        eq(wallets.status, "active"),
        sql`${wallets.availableBalance} >= ${row.amount}`,
      ));
      if (!hold[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Le solde disponible a changé ou ne suffit plus à réserver ce retrait." });
      reserved = true;
    }

    const systemNote = input.decision === "approve"
      ? `${input.note}\nRetrait approuvé; le montant total a été réservé. Le versement externe reste manuel et nécessite une référence de transfert.`
      : input.note;
    const changed = await tx.update(withdrawalRequests).set({ status, complianceNote: systemNote, providerReference: null }).where(and(
      eq(withdrawalRequests.id, row.id),
      inArray(withdrawalRequests.status, ["requested", "pending_review"]),
    ));
    if (!changed[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "La demande a déjà été traitée." });

    const reconciliationStatus = input.decision === "approve" ? "unmatched" as const : "exception" as const;
    const reconciliationNote = input.decision === "approve"
      ? `Montant réservé · débit total ${row.amount} ${row.currency} · frais ${row.feeAmount} · net à verser ${row.payoutAmount}. Aucun paiement externe envoyé automatiquement.`
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
      expectedAmount: row.payoutAmount,
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
      amount: row.amount,
      feeAmount: row.feeAmount,
      payoutAmount: row.payoutAmount,
      currency: row.currency,
    }));
    return { status, reserved, amount: row.amount, currency: row.currency };
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: `funding.withdrawal.${input.decision}`,
    entityType: "withdrawal_request",
    entityId: String(input.id),
    severity: input.decision === "reject" ? "warning" : "info",
    metadata: { note: input.note, status: result.status, payoutAutomaticallyEnabled: false, balanceReserved: result.reserved, amount: result.amount, currency: result.currency },
  });
  return { success: true as const, status: result.status };
}

export async function completeWithdrawalPayout(input: {
  actorUserId: number;
  id: number;
  externalPayoutReference: string;
  note: string;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour enregistrer un versement." });
  const completedAt = new Date();

  const result = await db.transaction(async tx => {
    const row = (await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, input.id)).limit(1).for("update"))[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Demande de retrait introuvable." });
    if (row.status !== "approved_pending_payout") throw new TRPCError({ code: "CONFLICT", message: "Seul un retrait approuvé et réservé peut être réglé." });
    const kyc = (await tx.select().from(kycCases).where(eq(kycCases.userId, row.userId)).orderBy(desc(kycCases.updatedAt), desc(kycCases.id)).limit(1).for("update"))[0];
    const limits = (await tx.select().from(riskLimits).where(eq(riskLimits.userId, row.userId)).limit(1).for("update"))[0];
    const wallet = (await tx.select().from(wallets).where(eq(wallets.id, row.walletId)).limit(1).for("update"))[0];
    const documents = kyc
      ? await tx.select({ documentType: kycDocuments.documentType, status: kycDocuments.status })
        .from(kycDocuments)
        .where(eq(kycDocuments.kycCaseId, kyc.id))
        .orderBy(desc(kycDocuments.createdAt), desc(kycDocuments.id))
        .for("update")
      : [];
    const eligibility = evaluateWithdrawalEligibility({
      kycStatus: kyc?.status,
      documents,
      riskStatus: limits?.status,
      walletStatus: wallet?.status,
    });
    if (!eligibility.eligible) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Le retrait ne peut pas être enregistré. ${describeWithdrawalEligibility(eligibility)}` });
    }
    if (!wallet || Number(wallet.pendingBalance) < Number(row.amount)) {
      throw new TRPCError({ code: "CONFLICT", message: "Le montant réservé n’est plus disponible dans le solde en attente." });
    }

    const changed = await tx.update(withdrawalRequests).set({
      status: "completed",
      providerReference: input.externalPayoutReference,
      payoutCompletedAt: completedAt,
      complianceNote: `${input.note}\nAfricoin a enregistré le versement externe; le débit total ${row.amount} ${row.currency} comprend ${row.feeAmount} ${row.currency} de frais et ${row.payoutAmount} ${row.currency} versés.`,
    }).where(and(eq(withdrawalRequests.id, row.id), eq(withdrawalRequests.status, "approved_pending_payout")));
    if (!changed[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Ce retrait a déjà été réglé." });

    const settledWallet = await tx.update(wallets).set({
      pendingBalance: sql`${wallets.pendingBalance} - ${row.amount}`,
      updatedAt: completedAt,
    }).where(and(eq(wallets.id, row.walletId), sql`${wallets.pendingBalance} >= ${row.amount}`));
    if (!settledWallet[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Le solde réservé a changé; aucun règlement n’a été enregistré." });
    await tx.insert(walletTransactions).values({
      walletId: row.walletId,
      userId: row.userId,
      type: "withdrawal",
      direction: "debit",
      amount: row.payoutAmount,
      currency: row.currency,
      status: "completed",
      reference: `${row.reference}-PAYOUT`,
      providerReference: input.externalPayoutReference,
      description: "Retrait externe · net après frais Africoin de 2,5 %",
      completedAt,
    });
    if (Number(row.feeAmount) > 0) {
      await tx.insert(walletTransactions).values({
        walletId: row.walletId,
        userId: row.userId,
        type: "fee",
        direction: "debit",
        amount: row.feeAmount,
        currency: row.currency,
        status: "completed",
        reference: `${row.reference}-FEE`,
        providerReference: input.externalPayoutReference,
        description: "Frais de retrait Africoin (2,5 %)",
        completedAt,
      });
      await tx.insert(africoinFeeTransactions).values({
        withdrawalRequestId: row.id,
        userId: row.userId,
        withdrawalReference: row.reference,
        grossAmount: row.amount,
        feeAmount: row.feeAmount,
        payoutAmount: row.payoutAmount,
        currency: row.currency,
        externalPayoutReference: input.externalPayoutReference,
        recordedBy: input.actorUserId,
        createdAt: completedAt,
        collectedAt: completedAt,
      });
    }

    const reconciliationNote = `Versement externe enregistré · débit total ${row.amount} ${row.currency} · frais Africoin ${row.feeAmount} · montant versé ${row.payoutAmount}. ${input.note}`;
    await tx.update(reconciliationRecords).set({
      status: "matched",
      settledAmount: row.payoutAmount,
      providerReference: input.externalPayoutReference,
      reviewNote: reconciliationNote,
      reviewedBy: input.actorUserId,
    }).where(eq(reconciliationRecords.requestReference, row.reference));
    await tx.insert(reconciliationHistory).values({
      requestReference: row.reference,
      entityType: "withdrawal",
      expectedAmount: row.payoutAmount,
      settledAmount: row.payoutAmount,
      currency: row.currency,
      status: "matched",
      providerReference: input.externalPayoutReference,
      reviewNote: reconciliationNote,
      reviewedBy: input.actorUserId,
    });
    await tx.insert(notifications).values({
      userId: row.userId,
      type: "withdrawal",
      title: "Retrait réglé",
      message: `${row.reference} · ${row.payoutAmount} ${row.currency} versés après ${row.feeAmount} ${row.currency} de frais Africoin. Référence externe : ${input.externalPayoutReference}.`,
    });
    return {
      userId: row.userId,
      reference: row.reference,
      totalDebit: row.amount,
      feeAmount: row.feeAmount,
      payoutAmount: row.payoutAmount,
      currency: row.currency,
    };
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "funding.withdrawal.payout_completed",
    entityType: "withdrawal_request",
    entityId: String(input.id),
    metadata: { ...result, externalPayoutReference: input.externalPayoutReference, note: input.note, feeLedgerCreated: Number(result.feeAmount) > 0 },
  });
  return { success: true as const, status: "completed" as const, ...result };
}

export async function cancelApprovedWithdrawalRequest(input: { actorUserId: number; id: number; note: string }) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "La base de données est requise pour annuler un retrait." });
  const result = await db.transaction(async tx => {
    const row = (await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, input.id)).limit(1).for("update"))[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Demande de retrait introuvable." });
    if (row.status !== "approved_pending_payout") throw new TRPCError({ code: "CONFLICT", message: "Seul un retrait approuvé et non payé peut être annulé." });
    const wallet = (await tx.select().from(wallets).where(eq(wallets.id, row.walletId)).limit(1).for("update"))[0];
    if (!wallet) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Portefeuille indisponible pour libérer le solde." });
    const released = await tx.update(wallets).set({
      availableBalance: sql`${wallets.availableBalance} + ${row.amount}`,
      pendingBalance: sql`${wallets.pendingBalance} - ${row.amount}`,
      updatedAt: new Date(),
    }).where(and(eq(wallets.id, row.walletId), sql`${wallets.pendingBalance} >= ${row.amount}`));
    if (!released[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Impossible de libérer intégralement le montant réservé." });
    const changed = await tx.update(withdrawalRequests).set({
      status: "failed",
      complianceNote: `${input.note}\nRetrait annulé avant versement; le montant total réservé a été libéré et aucun frais n’a été prélevé.`,
    }).where(and(eq(withdrawalRequests.id, row.id), eq(withdrawalRequests.status, "approved_pending_payout")));
    if (!changed[0]?.affectedRows) throw new TRPCError({ code: "CONFLICT", message: "Ce retrait a déjà été traité." });
    const reconciliationNote = `Retrait annulé avant versement. ${input.note}`;
    await tx.update(reconciliationRecords).set({
      status: "exception",
      settledAmount: null,
      providerReference: null,
      reviewNote: reconciliationNote,
      reviewedBy: input.actorUserId,
    }).where(eq(reconciliationRecords.requestReference, row.reference));
    await tx.insert(reconciliationHistory).values({
      requestReference: row.reference,
      entityType: "withdrawal",
      expectedAmount: row.payoutAmount,
      currency: row.currency,
      status: "exception",
      reviewNote: reconciliationNote,
      reviewedBy: input.actorUserId,
    });
    await tx.insert(notifications).values(buildWithdrawalCancelledNotification({
      userId: row.userId,
      reference: row.reference,
      amount: row.amount,
      currency: row.currency,
      note: input.note,
    }));
    return { userId: row.userId, reference: row.reference, totalDebit: row.amount, currency: row.currency };
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "funding.withdrawal.payout_cancelled",
    entityType: "withdrawal_request",
    entityId: String(input.id),
    severity: "warning",
    metadata: { ...result, note: input.note, amountReleased: true, feeCollected: false },
  });
  return { success: true as const, status: "failed" as const, ...result };
}
