import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  adminApprovalDecisions,
  adminApprovalRequests,
  complianceAlerts,
  notifications,
  riskLimits,
  users,
} from "../drizzle/schema";
import type { PlatformRole, Permission } from "@shared/permissions";
import { getDb, getOrCreateRiskLimit, writeAuditLog } from "./db";

export type ApprovalActionType = "role_change" | "account_status" | "limit_update";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
export type ApprovalDecision = "approve" | "reject";

export type ApprovalPayload = {
  targetUserId: number;
  role?: "user" | "compliance" | "admin" | "super_admin";
  status?: "active" | "restricted" | "blocked";
  dailyDepositLimit?: number;
  dailyWithdrawalLimit?: number;
  orderNotionalLimit?: number;
};

const permissionByAction: Record<ApprovalActionType, Permission> = {
  role_change: "user.role",
  account_status: "user.status",
  limit_update: "limits.manage",
};

function normalizeActionType(actionType: string): ApprovalActionType {
  if (actionType === "user.role" || actionType === "role_change") return "role_change";
  if (actionType === "user.status" || actionType === "account_status") return "account_status";
  return "limit_update";
}

function storageActionType(actionType: ApprovalActionType) {
  return { role_change: "user.role", account_status: "user.status", limit_update: "risk.limit" }[actionType];
}

export function actionLabel(actionType: ApprovalActionType | string) {
  return {
    role_change: "Modification de rôle",
    account_status: "Statut de compte",
    limit_update: "Limites de risque",
  }[normalizeActionType(actionType)];
}

export function canApproveAction(actionType: ApprovalActionType, role: PlatformRole) {
  if (actionType === "role_change") return role === "super_admin";
  if (actionType === "account_status") return role === "admin" || role === "super_admin";
  return role === "compliance" || role === "super_admin";
}

export function validateApprovalRequest(input: {
  actionType: ApprovalActionType;
  requesterUserId: number;
  payload: ApprovalPayload;
}) {
  if (input.actionType === "role_change" && input.requesterUserId === input.payload.targetUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas modifier son propre rôle." });
  }
  if (
    input.actionType === "account_status" &&
    input.requesterUserId === input.payload.targetUserId &&
    input.payload.status !== "active"
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Un administrateur ne peut pas se bloquer lui-même." });
  }
  if (input.actionType === "role_change" && !input.payload.role) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Le nouveau rôle est requis." });
  }
  if (input.actionType === "account_status" && !input.payload.status) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Le nouveau statut est requis." });
  }
  if (
    input.actionType === "limit_update" &&
    [input.payload.dailyDepositLimit, input.payload.dailyWithdrawalLimit, input.payload.orderNotionalLimit].some(
      value => value === undefined || value <= 0,
    )
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Les trois limites positives sont requises." });
  }
}

export async function createApprovalRequest(input: {
  actionType: ApprovalActionType;
  requesterUserId: number;
  targetUserId: number;
  payload: ApprovalPayload;
  reason: string;
}) {
  validateApprovalRequest(input);
  const db = await getDb();
  if (!db) {
    return { requestId: 0, status: "pending" as const, requiredApprovals: 2, approvedCount: 0 };
  }
  const existing = await db
    .select()
    .from(adminApprovalRequests)
    .where(and(eq(adminApprovalRequests.status, "pending"), eq(adminApprovalRequests.requestedBy, input.requesterUserId)))
    .limit(1);
  if (existing[0]) {
    throw new TRPCError({ code: "CONFLICT", message: "Une demande d’approbation est déjà ouverte pour cet administrateur." });
  }
  const inserted = await db.insert(adminApprovalRequests).values({
    actionType: storageActionType(input.actionType),
    targetType: "user",
    targetId: String(input.targetUserId),
    payload: JSON.stringify(input.payload),
    status: "pending",
    requestedBy: input.requesterUserId,
    reason: input.reason,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const requestId = Number(inserted[0]?.insertId ?? 0);
  await writeAuditLog({
    actorUserId: input.requesterUserId,
    action: "admin.approval_requested",
    entityType: "admin_approval_request",
    entityId: String(requestId),
    severity: "warning",
    metadata: { actionType: input.actionType, targetUserId: input.targetUserId, reason: input.reason },
  });
  return { requestId, status: "pending" as const, requiredApprovals: 2, approvedCount: 0 };
}

function parsePayload(payload: string): ApprovalPayload {
  try {
    return JSON.parse(payload) as ApprovalPayload;
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "La demande d’approbation est invalide." });
  }
}

async function executeApprovedRequest(request: typeof adminApprovalRequests.$inferSelect, payload: ApprovalPayload, approverUserId: number) {
  const db = await getDb();
  if (!db) return;
  const actionType = normalizeActionType(request.actionType);
  if (actionType === "role_change" && payload.role) {
    await db.update(users).set({ role: payload.role }).where(eq(users.id, payload.targetUserId));
  }
  if (actionType === "account_status" && payload.status) {
    await getOrCreateRiskLimit(payload.targetUserId);
    await db.update(riskLimits).set({ status: payload.status, updatedBy: approverUserId }).where(eq(riskLimits.userId, payload.targetUserId));
    if (payload.status === "blocked") {
      await db.insert(complianceAlerts).values({ userId: payload.targetUserId, type: "manual", severity: "high", status: "open", description: request.reason, assignedTo: approverUserId });
      await db.insert(notifications).values({ userId: payload.targetUserId, type: "compliance", title: "Compte placé en revue", message: "Une action de gouvernance limite temporairement les mouvements." });
    }
  }
  if (
    actionType === "limit_update" &&
    payload.dailyDepositLimit !== undefined &&
    payload.dailyWithdrawalLimit !== undefined &&
    payload.orderNotionalLimit !== undefined
  ) {
    await getOrCreateRiskLimit(payload.targetUserId);
    await db
      .update(riskLimits)
      .set({
        dailyDepositLimit: payload.dailyDepositLimit.toFixed(8),
        dailyWithdrawalLimit: payload.dailyWithdrawalLimit.toFixed(8),
        orderNotionalLimit: payload.orderNotionalLimit.toFixed(8),
        ...(payload.status ? { status: payload.status } : {}),
        updatedBy: approverUserId,
      })
      .where(eq(riskLimits.userId, payload.targetUserId));
  }
}

export async function decideApproval(input: {
  requestId: number;
  approverUserId: number;
  approverRole: PlatformRole;
  decision: ApprovalDecision;
  note?: string;
}) {
  const db = await getDb();
  if (!db) {
    return { requestId: input.requestId, status: "pending" as const, approvedCount: input.decision === "approve" ? 1 : 0, requiredApprovals: 2, executed: false };
  }
  const request = (await db.select().from(adminApprovalRequests).where(eq(adminApprovalRequests.id, input.requestId)).limit(1))[0];
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Demande d’approbation introuvable." });
  if (request.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Cette demande n’est plus en attente." });
  if (request.requestedBy === input.approverUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Le demandeur ne peut pas approuver sa propre demande." });
  if (!canApproveAction(normalizeActionType(request.actionType), input.approverRole)) throw new TRPCError({ code: "FORBIDDEN", message: "Votre rôle ne peut pas décider cette demande." });
  const previous = await db
    .select()
    .from(adminApprovalDecisions)
    .where(and(eq(adminApprovalDecisions.requestId, input.requestId), eq(adminApprovalDecisions.approverId, input.approverUserId)))
    .limit(1);
  if (previous[0]) throw new TRPCError({ code: "CONFLICT", message: "Vous avez déjà décidé cette demande." });
  await db.insert(adminApprovalDecisions).values({ requestId: input.requestId, approverId: input.approverUserId, decision: input.decision === "approve" ? "approved" : "rejected", note: input.note });
  const decisions = await db.select().from(adminApprovalDecisions).where(eq(adminApprovalDecisions.requestId, input.requestId));
  if (input.decision === "reject") {
    await db.update(adminApprovalRequests).set({ status: "rejected" }).where(eq(adminApprovalRequests.id, input.requestId));
    await writeAuditLog({ actorUserId: input.approverUserId, action: "admin.approval_rejected", entityType: "admin_approval_request", entityId: String(input.requestId), severity: "warning", metadata: { note: input.note } });
    return { requestId: input.requestId, status: "rejected" as const, approvedCount: decisions.filter(row => row.decision === "approved").length, requiredApprovals: 2, executed: false };
  }
  const quorum = resolveApprovalStatus(decisions.map(row => ({ approverUserId: row.approverId, decision: row.decision === "approved" ? "approve" : "reject" })), 2);
  const approvedCount = quorum.approvedCount;
  if (quorum.status !== "approved") {
    await writeAuditLog({ actorUserId: input.approverUserId, action: "admin.approval_recorded", entityType: "admin_approval_request", entityId: String(input.requestId), metadata: { approvedCount, requiredApprovals: 2 } });
    return { requestId: input.requestId, status: "pending" as const, approvedCount, requiredApprovals: 2, executed: false };
  }
  const payload = parsePayload(request.payload);
  await executeApprovedRequest(request, payload, input.approverUserId);
  await db.update(adminApprovalRequests).set({ status: "executed" }).where(eq(adminApprovalRequests.id, input.requestId));
  await writeAuditLog({ actorUserId: input.approverUserId, action: "admin.approval_executed", entityType: "admin_approval_request", entityId: String(input.requestId), severity: "critical", metadata: { actionType: normalizeActionType(request.actionType), targetUserId: payload.targetUserId, approvedCount } });
  return { requestId: input.requestId, status: "approved" as const, approvedCount, requiredApprovals: 2, executed: true };
}

export async function listApprovalRequests() {
  const db = await getDb();
  if (!db) return { pending: [], history: [] };
  const requests = await db.select().from(adminApprovalRequests).orderBy(desc(adminApprovalRequests.createdAt)).limit(100);
  const decisions = requests.length
    ? await db.select().from(adminApprovalDecisions)
    : [];
  const actorIds = Array.from(new Set(requests.flatMap(request => [request.requestedBy, Number(request.targetId)].filter((id): id is number => Number.isFinite(id))).concat(decisions.map(decision => decision.approverId))));
  const actors = actorIds.length ? await db.select().from(users).where(inArray(users.id, actorIds)) : [];
  const actorById = new Map(actors.map(actor => [actor.id, actor]));
  const mapRequest = (request: typeof requests[number]) => ({
    ...request,
    status: request.status === "executed" ? "approved" : request.status,
    requiredApprovals: 2,
    payload: { ...parsePayload(request.payload), targetUserId: Number(request.targetId) },
    actionLabel: actionLabel(request.actionType),
    requesterUserId: request.requestedBy,
    targetUserId: Number(request.targetId),
    requester: actorById.get(request.requestedBy) ? { id: request.requestedBy, name: actorById.get(request.requestedBy)?.name } : null,
    target: actorById.get(Number(request.targetId)) ? { id: Number(request.targetId), name: actorById.get(Number(request.targetId))?.name } : null,
    decisions: decisions.filter(decision => decision.requestId === request.id).map(decision => ({ ...decision, approverUserId: decision.approverId, approver: actorById.get(decision.approverId)?.name ?? `#${decision.approverId}` })),
  });
  const mapped = requests.map(mapRequest);
  return { pending: mapped.filter(request => request.status === "pending"), history: mapped.filter(request => request.status !== "pending") };
}

export function permissionForApprovalAction(actionType: ApprovalActionType) {
  return permissionByAction[actionType];
}

export function resolveApprovalStatus(decisions: Array<{ approverUserId: number; decision: ApprovalDecision }>, requiredApprovals = 2) {
  const uniqueApprovers = new Set(decisions.map(decision => decision.approverUserId));
  const approvedCount = decisions.filter(decision => decision.decision === "approve").length;
  const rejected = decisions.some(decision => decision.decision === "reject");
  return {
    status: rejected ? "rejected" as const : approvedCount >= requiredApprovals && uniqueApprovers.size >= requiredApprovals ? "approved" as const : "pending" as const,
    approvedCount,
    uniqueApproverCount: uniqueApprovers.size,
  };
}
