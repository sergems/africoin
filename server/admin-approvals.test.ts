import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { actionLabel, canApproveAction, resolveApprovalStatus, validateApprovalRequest } from "./adminApprovals";

function context(role: "user" | "compliance" | "admin" | "super_admin" = "user"): TrpcContext {
  return { user: { id: 910001, openId: `approval-${role}`, name: "Approval Test", email: "approval@example.com", loginMethod: "test", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as TrpcContext["res"] };
}

describe("admin approval governance", () => {
  it("requires two distinct approvals before execution", () => {
    expect(resolveApprovalStatus([{ approverUserId: 2, decision: "approve" }, { approverUserId: 2, decision: "approve" }])).toMatchObject({ status: "pending", approvedCount: 2, uniqueApproverCount: 1 });
    expect(resolveApprovalStatus([{ approverUserId: 2, decision: "approve" }, { approverUserId: 3, decision: "approve" }])).toMatchObject({ status: "approved", approvedCount: 2, uniqueApproverCount: 2 });
  });

  it("rejects a request as soon as one valid approver rejects it", () => {
    expect(resolveApprovalStatus([{ approverUserId: 2, decision: "approve" }, { approverUserId: 3, decision: "reject" }]).status).toBe("rejected");
  });

  it("keeps sensitive action approver scopes distinct", () => {
    expect(canApproveAction("role_change", "super_admin")).toBe(true);
    expect(canApproveAction("role_change", "admin")).toBe(false);
    expect(canApproveAction("account_status", "admin")).toBe(true);
    expect(canApproveAction("limit_update", "compliance")).toBe(true);
    expect(canApproveAction("limit_update", "admin")).toBe(false);
    expect(actionLabel("limit_update")).toBe("Limites de risque");
  });

  it("prevents self-approval-sensitive actions before persistence", () => {
    expect(() => validateApprovalRequest({ actionType: "role_change", requesterUserId: 7, payload: { targetUserId: 7, role: "admin" } })).toThrow("propre rôle");
    expect(() => validateApprovalRequest({ actionType: "account_status", requesterUserId: 7, payload: { targetUserId: 7, status: "blocked" } })).toThrow("se bloquer");
    expect(() => validateApprovalRequest({ actionType: "limit_update", requesterUserId: 7, payload: { targetUserId: 9, dailyDepositLimit: 1 } })).toThrow("trois limites");
  });

  it("protects approval listing from ordinary users", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.adminApprovals.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an authorized compliance role to read the governance queue", async () => {
    const caller = appRouter.createCaller(context("compliance"));
    const result = await caller.adminApprovals.list();
    expect(Array.isArray(result.pending)).toBe(true);
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history.every(item => typeof item.actionLabel === "string")).toBe(true);
  });
});
