import express, { type Express } from "express";
import { isIP } from "node:net";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  depositRequests,
  kycCases,
  notifications,
  reconciliationHistory,
  reconciliationRecords,
  riskLimits,
  users,
  walletTransactions,
  wallets,
} from "../drizzle/schema";
import { getDb, writeAuditLog } from "./db";

export const KELPAY_CALLBACK_PATH = "/api/payments/kelpay/callback";
const KELPAY_PAYMENT_URL = "https://pay.keccel.com/kelpay/v1/payment.asp";
const KELPAY_CHECK_URL = "https://pay.keccel.com/kelpay/v1/checktransaction.asp";
const MAX_STATUS_CHECKS = 3;
const STATUS_CHECK_INTERVAL_MS = 5_000;

export type KelpayCurrency = "CDF" | "USD";
export type KelpayInitialResult =
  | { kind: "accepted"; transactionId: string; description: string }
  | { kind: "rejected"; transactionId: string | null; description: string }
  | { kind: "uncertain"; transactionId: string | null; description: string };

export type KelpayOutcome =
  | { kind: "success"; transactionId: string; providerStatus: "SUCCESS"; description: string }
  | { kind: "failure"; transactionId: string; providerStatus: "FAILED"; description: string }
  | { kind: "pending"; transactionId: string; providerStatus: string; description: string }
  | { kind: "exception"; transactionId?: string; providerStatus: "VERIFICATION_EXCEPTION"; description: string };

export class KelpayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KelpayConfigurationError";
  }
}

export class KelpayTransportError extends Error {
  constructor(message = "Keccel could not be reached or returned an invalid response.") {
    super(message);
    this.name = "KelpayTransportError";
  }
}

function readCredentials() {
  const token = process.env.KECCEL_API_TOKEN?.trim();
  const merchantCode = process.env.KECCEL_MERCHANT_CODE?.trim();
  if (!token || !merchantCode) {
    throw new KelpayConfigurationError("Keccel merchant credentials are not configured.");
  }
  return { token, merchantCode };
}

function readCallbackUrl() {
  const value = process.env.KECCEL_CALLBACK_URL?.trim();
  if (!value) {
    throw new KelpayConfigurationError("The public HTTPS Keccel callback URL is not configured.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KelpayConfigurationError("The Keccel callback URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== KELPAY_CALLBACK_PATH ||
    isIP(url.hostname) !== 0 ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  ) {
    throw new KelpayConfigurationError(`The Keccel callback URL must be HTTPS and end with ${KELPAY_CALLBACK_PATH}.`);
  }
  return url.toString();
}

export function assertKelpayPayinConfigured() {
  readCredentials();
  readCallbackUrl();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function responseCode(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function responseText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return sanitized ? sanitized.slice(0, 400) : fallback;
}

function transactionId(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result && result.length <= 180 ? result : null;
}

async function postKelpay(url: string, payload: Record<string, unknown>) {
  const { token } = readCredentials();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new KelpayTransportError();
  }
  if (!response.ok) throw new KelpayTransportError();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new KelpayTransportError();
  }
  const record = asRecord(body);
  if (!record) throw new KelpayTransportError();
  return record;
}

export async function submitKelpayPayin(input: {
  reference: string;
  mobileNumber: string;
  amount: string;
  currency: KelpayCurrency;
  description: string;
}): Promise<KelpayInitialResult> {
  const { merchantCode } = readCredentials();
  const callbackUrl = readCallbackUrl();
  let payload: Record<string, unknown>;
  try {
    payload = await postKelpay(KELPAY_PAYMENT_URL, {
      merchantcode: merchantCode,
      mobilenumber: input.mobileNumber,
      reference: input.reference,
      amount: Number(input.amount),
      currency: input.currency,
      description: input.description,
      callbackurl: callbackUrl,
    });
  } catch (error) {
    if (error instanceof KelpayConfigurationError) throw error;
    return { kind: "uncertain", transactionId: null, description: "Keccel did not return a confirmed response. Check the transaction status before retrying." };
  }

  const code = responseCode(payload.code);
  const returnedReference = typeof payload.reference === "string" ? payload.reference.trim() : "";
  const id = transactionId(payload.transactionid);
  const description = responseText(payload.description, "Keccel returned no description.");
  if (returnedReference !== input.reference) {
    return { kind: "uncertain", transactionId: id, description: "Keccel returned a reference that does not match this deposit." };
  }
  if (code === 0 && id) return { kind: "accepted", transactionId: id, description };
  if (code === 1) return { kind: "rejected", transactionId: id, description };
  return { kind: "uncertain", transactionId: id, description: "Keccel returned an incomplete or unrecognized payment response." };
}

export async function checkKelpayTransaction(input: {
  transactionId: string;
}): Promise<Record<string, unknown>> {
  const { merchantCode } = readCredentials();
  return postKelpay(KELPAY_CHECK_URL, {
    merchantcode: merchantCode,
    transactionid: input.transactionId,
  });
}

export function classifyKelpayCheckResponse(
  payload: Record<string, unknown>,
  expected: {
    merchantCode: string;
    reference: string;
    transactionId: string;
    amount: string;
    currency: KelpayCurrency;
  },
): KelpayOutcome {
  const returnedMerchant = typeof payload.merchantcode === "string" ? payload.merchantcode.trim() : "";
  const returnedReference = typeof payload.reference === "string" ? payload.reference.trim() : "";
  const returnedTransactionId = transactionId(payload.transactionid);
  const returnedCurrency = typeof payload.currency === "string" ? payload.currency.trim().toUpperCase() : "";
  const returnedAmount = typeof payload.amount === "number" || typeof payload.amount === "string" ? Number(payload.amount) : Number.NaN;
  const expectedAmount = Number(expected.amount);

  if (
    returnedMerchant !== expected.merchantCode ||
    returnedReference !== expected.reference ||
    returnedTransactionId !== expected.transactionId ||
    returnedCurrency !== expected.currency ||
    !Number.isFinite(returnedAmount) ||
    !Number.isFinite(expectedAmount) ||
    returnedAmount !== expectedAmount
  ) {
    return {
      kind: "exception",
      providerStatus: "VERIFICATION_EXCEPTION",
      description: "Keccel status details did not match the original merchant, reference, amount or currency.",
    };
  }

  const code = responseCode(payload.code);
  const status = typeof payload.transactionstatus === "string" ? payload.transactionstatus.trim().toUpperCase() : "";
  const description = responseText(payload.description, `Keccel transaction status: ${status || "unknown"}.`);

  const verifiedTransactionId = returnedTransactionId as string;
  if (code === 0 && status === "SUCCESS") return { kind: "success", transactionId: verifiedTransactionId, providerStatus: "SUCCESS", description };
  if (code === 1 && status === "FAILED") return { kind: "failure", transactionId: verifiedTransactionId, providerStatus: "FAILED", description };
  if (["PENDING", "PROCESSING", "INITIATED"].includes(status) && code !== 1) {
    return { kind: "pending", transactionId: verifiedTransactionId, providerStatus: status, description };
  }
  return {
    kind: "exception",
    transactionId: verifiedTransactionId,
    providerStatus: "VERIFICATION_EXCEPTION",
    description: "Keccel returned an unrecognized or contradictory final transaction status.",
  };
}

async function currentDeposit(reference: string) {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const rows = await db.select().from(depositRequests).where(eq(depositRequests.reference, reference)).limit(1);
  return rows[0] ?? null;
}

function depositMessage(status: string, providerStatus: string | null | undefined) {
  if (status === "completed") return "Keccel a confirmé le paiement et le portefeuille a été crédité.";
  if (status === "failed") return "Keccel a confirmé l’échec du paiement. Aucun fonds n’a été crédité.";
  if (providerStatus === "SUCCESS_COMPLIANCE_HOLD") return "Keccel a confirmé le paiement, mais votre compte nécessite une revue de conformité. Aucun fonds n’a été crédité.";
  if (providerStatus === "SUBMISSION_UNKNOWN" || providerStatus === "STATUS_CHECK_UNAVAILABLE") {
    return "Le résultat du paiement n’est pas encore confirmé. Vérifiez son statut avant de créer un autre paiement.";
  }
  if (providerStatus === "VERIFICATION_EXCEPTION") return "La réponse de Keccel nécessite une réconciliation manuelle. Aucun fonds n’a été crédité.";
  if (providerStatus === "REQUEST_ACCEPTED" || providerStatus === "PENDING" || providerStatus === "PROCESSING" || providerStatus === "INITIATED") {
    return "Demande envoyée. Confirmez-la sur votre téléphone ; le portefeuille sera crédité après confirmation de Keccel.";
  }
  return "Le statut du paiement est en cours de vérification. Le portefeuille n’a pas encore été crédité.";
}

export function toKelpayClientStatus(row: {
  status: string;
  providerStatus?: string | null;
  providerCheckCount?: number;
  providerReference?: string | null;
  candidateTransactionId?: string | null;
}) {
  return {
    status: row.status,
    providerStatus: row.providerStatus ?? null,
    statusChecksRemaining: Math.max(0, MAX_STATUS_CHECKS - (row.providerCheckCount ?? 0)),
    canCheckStatus: ["processing", "pending_review"].includes(row.status) && !["VERIFICATION_EXCEPTION", "SUCCESS_COMPLIANCE_HOLD"].includes(row.providerStatus ?? "") && Boolean(row.providerReference || row.candidateTransactionId) && (row.providerCheckCount ?? 0) < MAX_STATUS_CHECKS,
    message: depositMessage(row.status, row.providerStatus),
  };
}

export function isKelpaySettlementEligible(kycStatus: string | null | undefined, riskStatus: string | null | undefined) {
  return kycStatus === "approved" && riskStatus === "active";
}

async function updateReconciliation(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  row: typeof depositRequests.$inferSelect,
  outcome: KelpayOutcome,
) {
  const reconciliationStatus = outcome.kind === "success" ? "matched" : outcome.kind === "failure" || outcome.kind === "exception" ? "exception" : "unmatched";
  const settledAmount = outcome.kind === "success" ? row.amount : undefined;
  const providerReference = outcome.transactionId ?? row.providerReference ?? undefined;
  await db.update(reconciliationRecords).set({
    status: reconciliationStatus,
    settledAmount,
    providerReference,
    reviewNote: outcome.description,
  }).where(eq(reconciliationRecords.requestReference, row.reference));
  await db.insert(reconciliationHistory).values({
    requestReference: row.reference,
    entityType: "deposit",
    expectedAmount: row.amount,
    settledAmount,
    currency: row.currency,
    status: reconciliationStatus,
    providerReference,
    reviewNote: outcome.description,
  });
}

async function applyKelpayOutcome(reference: string, outcome: KelpayOutcome) {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const row = await currentDeposit(reference);
  if (!row || row.paymentProvider !== "KECCEL") return { status: "not_found" as const };
  if (row.status === "completed" || row.status === "failed" || row.status === "rejected") {
    return { ...toKelpayClientStatus(row), status: row.status };
  }

  if (outcome.kind === "exception") {
    await db.update(depositRequests).set({
      status: "pending_review",
      providerStatus: outcome.providerStatus,
      providerReference: outcome.transactionId ?? undefined,
      candidateTransactionId: null,
      complianceNote: outcome.description,
      updatedAt: new Date(),
    }).where(and(eq(depositRequests.id, row.id), inArray(depositRequests.status, ["processing", "pending_review"])));
    await updateReconciliation(db, row, outcome);
    await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_verification_exception", entityType: "deposit_request", entityId: row.reference, severity: "critical", metadata: { providerStatus: outcome.providerStatus } });
    const latest = await currentDeposit(reference);
    return latest ? toKelpayClientStatus(latest) : { status: "not_found" as const };
  }

  if (outcome.kind === "pending") {
    await db.update(depositRequests).set({ providerReference: outcome.transactionId, candidateTransactionId: null, providerStatus: outcome.providerStatus, complianceNote: outcome.description, updatedAt: new Date() })
      .where(and(eq(depositRequests.id, row.id), inArray(depositRequests.status, ["processing", "pending_review"])));
    await updateReconciliation(db, row, outcome);
    const latest = await currentDeposit(reference);
    return latest ? toKelpayClientStatus(latest) : { status: "not_found" as const };
  }

  if (outcome.kind === "failure") {
    let failed = false;
    await db.transaction(async tx => {
      const changed = await tx.update(depositRequests).set({
        status: "failed",
        providerStatus: outcome.providerStatus,
        providerReference: outcome.transactionId,
        candidateTransactionId: null,
        complianceNote: outcome.description,
        updatedAt: new Date(),
      }).where(and(eq(depositRequests.id, row.id), eq(depositRequests.paymentProvider, "KECCEL"), inArray(depositRequests.status, ["processing", "pending_review"])));
      if (!changed[0]?.affectedRows) return;
      failed = true;
      await tx.update(reconciliationRecords).set({ status: "exception", providerReference: outcome.transactionId, reviewNote: outcome.description }).where(eq(reconciliationRecords.requestReference, row.reference));
      await tx.insert(reconciliationHistory).values({ requestReference: row.reference, entityType: "deposit", expectedAmount: row.amount, currency: row.currency, status: "exception", providerReference: outcome.transactionId, reviewNote: outcome.description });
      await tx.insert(notifications).values({ userId: row.userId, type: "deposit", title: "Paiement Keccel échoué", message: `${row.reference} · aucun fonds n’a été crédité.` });
    });
    if (failed) await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_failed", entityType: "deposit_request", entityId: row.reference, severity: "warning", metadata: { providerStatus: outcome.providerStatus } });
    const latest = await currentDeposit(reference);
    return latest ? toKelpayClientStatus(latest) : { status: "not_found" as const };
  }

  let credited = false;
  let complianceHeld = false;
  const complianceHoldNote = "Keccel confirmed the payment, but the account no longer meets the current KYC/risk settlement policy; funds are held for manual compliance review.";
  await db.transaction(async tx => {
    const account = (await tx.select({ id: users.id }).from(users).where(eq(users.id, row.userId)).for("update"))[0];
    const kyc = (await tx.select().from(kycCases).where(eq(kycCases.userId, row.userId)).orderBy(desc(kycCases.updatedAt)).limit(1).for("update"))[0];
    const limits = (await tx.select().from(riskLimits).where(eq(riskLimits.userId, row.userId)).limit(1).for("update"))[0];
    const eligibleForSettlement = Boolean(account && isKelpaySettlementEligible(kyc?.status, limits?.status));
    const providerReference = outcome.transactionId ?? row.providerReference ?? undefined;
    const changed = await tx.update(depositRequests).set({
      status: eligibleForSettlement ? "completed" : "pending_review",
      providerStatus: eligibleForSettlement ? outcome.providerStatus : "SUCCESS_COMPLIANCE_HOLD",
      providerReference,
      candidateTransactionId: null,
      complianceNote: eligibleForSettlement ? outcome.description : complianceHoldNote,
      updatedAt: new Date(),
    }).where(and(eq(depositRequests.id, row.id), eq(depositRequests.paymentProvider, "KECCEL"), inArray(depositRequests.status, ["processing", "pending_review"])));
    if (!changed[0]?.affectedRows) return;

    if (!eligibleForSettlement) {
      complianceHeld = true;
      await tx.update(reconciliationRecords).set({ status: "exception", settledAmount: row.amount, providerReference, reviewNote: complianceHoldNote }).where(eq(reconciliationRecords.requestReference, row.reference));
      await tx.insert(reconciliationHistory).values({ requestReference: row.reference, entityType: "deposit", expectedAmount: row.amount, settledAmount: row.amount, currency: row.currency, status: "exception", providerReference, reviewNote: complianceHoldNote });
      await tx.insert(notifications).values({ userId: row.userId, type: "deposit", title: "Paiement confirmé — revue conformité", message: `${row.amount} ${row.currency} · ${row.reference} · contactez le support. Aucun fonds n’a été crédité.` });
      return;
    }

    const walletUpdated = await tx.update(wallets).set({
      availableBalance: sql`${wallets.availableBalance} + ${row.amount}`,
      updatedAt: new Date(),
    }).where(eq(wallets.id, row.walletId));
    if (!walletUpdated[0]?.affectedRows) throw new Error("The deposit wallet no longer exists.");
    await tx.insert(walletTransactions).values({
      walletId: row.walletId,
      userId: row.userId,
      type: "deposit",
      direction: "credit",
      amount: row.amount,
      currency: row.currency,
      status: "completed",
      reference: row.reference,
      providerReference,
      description: "Dépôt mobile money confirmé par Keccel KelPay",
      completedAt: new Date(),
    });
    await tx.update(reconciliationRecords).set({
      status: "matched",
      settledAmount: row.amount,
      providerReference,
      reviewNote: outcome.description,
    }).where(eq(reconciliationRecords.requestReference, row.reference));
    await tx.insert(reconciliationHistory).values({
      requestReference: row.reference,
      entityType: "deposit",
      expectedAmount: row.amount,
      settledAmount: row.amount,
      currency: row.currency,
      status: "matched",
      providerReference,
      reviewNote: outcome.description,
    });
    await tx.insert(notifications).values({ userId: row.userId, type: "deposit", title: "Dépôt confirmé", message: `${row.amount} ${row.currency} · ${row.reference} · portefeuille crédité.` });
    credited = true;
  });
  if (credited) await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_completed", entityType: "deposit_request", entityId: row.reference, metadata: { amount: row.amount, currency: row.currency, providerReference: outcome.transactionId } });
  if (complianceHeld) await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_success_compliance_hold", entityType: "deposit_request", entityId: row.reference, severity: "critical", metadata: { amount: row.amount, currency: row.currency, providerReference: outcome.transactionId } });
  const latest = await currentDeposit(reference);
  return latest ? toKelpayClientStatus(latest) : { status: "not_found" as const };
}

async function recordImmediateResult(reference: string, result: KelpayInitialResult) {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const row = await currentDeposit(reference);
  if (!row || row.paymentProvider !== "KECCEL") return { status: "not_found" as const };

  const status = result.kind === "rejected" ? "failed" : result.kind === "uncertain" ? "pending_review" : "processing";
  const providerStatus = result.kind === "accepted" ? "REQUEST_ACCEPTED" : result.kind === "rejected" ? "REQUEST_REJECTED" : "SUBMISSION_UNKNOWN";
  const changed = await db.update(depositRequests).set({
    status,
    providerReference: result.kind === "uncertain" ? undefined : result.transactionId ?? undefined,
    candidateTransactionId: result.kind === "uncertain" ? result.transactionId ?? row.candidateTransactionId ?? null : null,
    providerStatus,
    statusCheckNotBefore: new Date(Date.now() + STATUS_CHECK_INTERVAL_MS),
    complianceNote: result.description,
    updatedAt: new Date(),
  }).where(and(eq(depositRequests.id, row.id), eq(depositRequests.paymentProvider, "KECCEL"), eq(depositRequests.status, "processing")));
  if (!changed[0]?.affectedRows) {
    const latest = await currentDeposit(reference);
    return latest ? toKelpayClientStatus(latest) : { status: "not_found" as const };
  }

  if (result.kind === "rejected") {
    await db.update(reconciliationRecords).set({ status: "exception", providerReference: result.transactionId ?? undefined, reviewNote: result.description }).where(eq(reconciliationRecords.requestReference, reference));
    await db.insert(reconciliationHistory).values({ requestReference: reference, entityType: "deposit", expectedAmount: row.amount, currency: row.currency, status: "exception", providerReference: result.transactionId ?? undefined, reviewNote: result.description });
    await db.insert(notifications).values({ userId: row.userId, type: "deposit", title: "Demande de paiement refusée", message: `${reference} · aucun fonds n’a été crédité.` });
  }
  await writeAuditLog({ actorUserId: row.userId, action: `deposit.keccel_${result.kind}`, entityType: "deposit_request", entityId: reference, severity: result.kind === "rejected" ? "warning" : "info", metadata: { providerStatus } });
  const latest = await currentDeposit(reference);
  return latest ? toKelpayClientStatus(latest) : { status: "not_found" as const };
}

export async function initiateKelpayDeposit(input: {
  reference: string;
  mobileNumber: string;
  amount: string;
  currency: KelpayCurrency;
}) {
  const result = await submitKelpayPayin({
    ...input,
    description: `Africoin wallet deposit ${input.reference}`,
  });
  return recordImmediateResult(input.reference, result);
}

function waitFor(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function checkAndApplyKelpayStatus(reference: string, callbackTransactionId?: string, waitForWindow = false) {
  const db = await getDb();
  if (!db) return { retry: true as const };
  let row = await currentDeposit(reference);
  if (!row || row.paymentProvider !== "KECCEL") return { ignored: true as const };
  if (["completed", "failed", "rejected"].includes(row.status)) return { result: toKelpayClientStatus(row) };

  if (callbackTransactionId) {
    if (row.providerReference && row.providerReference !== callbackTransactionId) {
      await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_callback_reference_mismatch", entityType: "deposit_request", entityId: reference, severity: "critical", metadata: { providerStatus: "CALLBACK_ID_MISMATCH" } });
      return { ignored: true as const };
    }
    if (!row.providerReference && row.candidateTransactionId && row.candidateTransactionId !== callbackTransactionId) {
      await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_callback_candidate_mismatch", entityType: "deposit_request", entityId: reference, severity: "critical", metadata: { providerStatus: "CALLBACK_CANDIDATE_MISMATCH" } });
      return { ignored: true as const };
    }
    if (!row.providerReference && !row.candidateTransactionId && ["processing", "pending_review"].includes(row.status)) {
      await db.update(depositRequests).set({ candidateTransactionId: callbackTransactionId, providerStatus: "CALLBACK_RECEIVED", updatedAt: new Date() })
        .where(and(eq(depositRequests.id, row.id), isNull(depositRequests.providerReference), isNull(depositRequests.candidateTransactionId), inArray(depositRequests.status, ["processing", "pending_review"])));
      row = await currentDeposit(reference);
      if (!row) return { ignored: true as const };
    }
  }

  if (waitForWindow) {
    for (let attempt = 0; attempt < 2; attempt++) {
      row = await currentDeposit(reference);
      if (!row || row.paymentProvider !== "KECCEL") return { ignored: true as const };
      if (["completed", "failed", "rejected"].includes(row.status)) return { result: toKelpayClientStatus(row) };
      if (callbackTransactionId && row.providerReference && row.providerReference !== callbackTransactionId) {
        await writeAuditLog({ actorUserId: row.userId, action: "deposit.keccel_callback_reference_mismatch", entityType: "deposit_request", entityId: reference, severity: "critical", metadata: { providerStatus: "CALLBACK_ID_MISMATCH" } });
        return { ignored: true as const };
      }
      const waitMilliseconds = Math.max(0, (row.statusCheckNotBefore?.getTime() ?? 0) - Date.now());
      if (waitMilliseconds <= 0) break;
      await waitFor(waitMilliseconds);
    }
    row = await currentDeposit(reference);
    if (!row || row.paymentProvider !== "KECCEL") return { ignored: true as const };
    if (["completed", "failed", "rejected"].includes(row.status)) return { result: toKelpayClientStatus(row) };
  }

  const id = row.providerReference ?? row.candidateTransactionId;
  if (!id) return { result: toKelpayClientStatus(row) };
  if (row.providerCheckCount >= MAX_STATUS_CHECKS) return { result: toKelpayClientStatus(row) };
  const now = new Date();
  const claimed = await db.update(depositRequests).set({
    providerCheckCount: sql`${depositRequests.providerCheckCount} + 1`,
    statusCheckNotBefore: new Date(now.getTime() + STATUS_CHECK_INTERVAL_MS),
  }).where(and(
    eq(depositRequests.id, row.id),
    eq(depositRequests.paymentProvider, "KECCEL"),
    inArray(depositRequests.status, ["processing", "pending_review"]),
    sql`${depositRequests.providerCheckCount} < ${MAX_STATUS_CHECKS}`,
    or(isNull(depositRequests.statusCheckNotBefore), lte(depositRequests.statusCheckNotBefore, now)),
  ));
  if (!claimed[0]?.affectedRows) {
    const latest = await currentDeposit(reference);
    return { result: latest ? toKelpayClientStatus(latest) : { status: "not_found" as const } };
  }

  let payload: Record<string, unknown>;
  try {
    payload = await checkKelpayTransaction({ transactionId: id });
  } catch {
    await db.update(depositRequests).set({ providerStatus: "STATUS_CHECK_UNAVAILABLE", complianceNote: "Keccel status check could not be completed. Do not create a duplicate payment." }).where(and(eq(depositRequests.id, row.id), inArray(depositRequests.status, ["processing", "pending_review"])));
    return { retry: true as const };
  }

  const merchantCode = process.env.KECCEL_MERCHANT_CODE?.trim() ?? "";
  const outcome = classifyKelpayCheckResponse(payload, {
    merchantCode,
    reference: row.reference,
    transactionId: id,
    amount: row.amount,
    currency: row.currency,
  });
  return { result: await applyKelpayOutcome(reference, outcome) };
}

export async function refreshKelpayDepositStatus(input: { userId: number; reference: string }) {
  const db = await getDb();
  if (!db) throw new Error("The database is not available.");
  const row = (await db.select().from(depositRequests).where(and(eq(depositRequests.reference, input.reference), eq(depositRequests.userId, input.userId), eq(depositRequests.paymentProvider, "KECCEL"))).limit(1))[0];
  if (!row) return null;
  if (!row.providerReference && !row.candidateTransactionId) return toKelpayClientStatus(row);
  const checked = await checkAndApplyKelpayStatus(row.reference);
  if ("result" in checked) return checked.result;
  const latest = await currentDeposit(row.reference);
  return latest ? toKelpayClientStatus(latest) : null;
}

export async function handleKelpayCallback(body: unknown): Promise<"processed" | "ignored" | "retry"> {
  const payload = asRecord(body);
  if (!payload || typeof payload.reference !== "string") return "ignored";
  const reference = payload.reference.trim();
  const callbackId = transactionId(payload.transactionid);
  if (!reference || reference.length > 120 || !callbackId) return "ignored";
  const outcome = await checkAndApplyKelpayStatus(reference, callbackId, true);
  return "retry" in outcome ? "retry" : "ignored" in outcome ? "ignored" : "processed";
}

export function registerKelpayCallbackRoute(app: Express) {
  app.post(KELPAY_CALLBACK_PATH, express.json({ limit: "16kb" }), async (req, res) => {
    try {
      const result = await handleKelpayCallback(req.body);
      res.status(result === "retry" ? 503 : 200).type("text/plain").send("OK");
    } catch {
      res.status(503).type("text/plain").send("OK");
    }
  });
}
