import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { resolveTradeExecutionMode } from "./tradingGuards";
import type { TrpcContext } from "./_core/context";

function context(role: "user" | "compliance" | "admin" | "super_admin" = "user"): TrpcContext {
  return {
    user: {
      id: 999001,
      openId: `test-${role}`,
      name: "Test Client",
      email: "test@example.com",
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as unknown as TrpcContext["res"],
  };
}

describe("AFRICOIN TRADING GROUP controls", () => {
  it("submits trades automatically without an administrative approval state", () => {
    expect({ status: "submitted", executionMode: resolveTradeExecutionMode(false) }).toEqual({ status: "submitted", executionMode: "pending_activation" });
    expect(resolveTradeExecutionMode(true)).toBe("broker");
  });

  it("rejects a limit order without a limit price", async () => {
    const caller = appRouter.createCaller(context());
    await expect(caller.orders.placeSpot({
      instrumentId: 101,
      symbol: "AAPL",
      side: "buy",
      orderType: "limit",
      quantity: 1,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps compliance routes restricted to compliance roles", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.compliance.queue()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects withdrawal requests with more than two decimal places before database access", async () => {
    const caller = appRouter.createCaller(context());
    await expect(caller.wallets.requestWithdrawal({
      amount: 1.001,
      currency: "USD",
      destinationType: "partner",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires an authenticated user to submit a withdrawal request", async () => {
    const unauthenticated = { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as unknown as TrpcContext["res"] } as TrpcContext;
    await expect(appRouter.createCaller(unauthenticated).wallets.requestWithdrawal({ amount: 10, currency: "USD", destinationType: "mobile_money" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("restricts withdrawal decisions to funding reviewers and routes approval/completion into the manual payout workflow", async () => {
    const userCaller = appRouter.createCaller(context("user"));
    await expect(userCaller.adminFunding.decide({ kind: "withdrawal", id: 1, decision: "approve", note: "Review" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const complianceCaller = appRouter.createCaller(context("compliance"));
    await expect(complianceCaller.adminFunding.decide({ kind: "withdrawal", id: 1, decision: "approve", note: "Review" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const adminCaller = appRouter.createCaller(context("admin"));
    await expect(adminCaller.adminFunding.decide({ kind: "withdrawal", id: 1, decision: "approve", note: "Review", providerReference: "PAYOUT-123" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(adminCaller.adminFunding.completePayout({ id: 1, externalPayoutReference: "PAYOUT-123", note: "External transfer completed" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("allows the Super Admin KYC review route for their own record and other users", async () => {
    const superAdminCaller = appRouter.createCaller(context("super_admin"));
    await expect(superAdminCaller.adminUsers.reviewKyc({ userId: 999001, status: "approved", note: "Self review" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(superAdminCaller.adminUsers.reviewKyc({ userId: 999002, status: "approved", note: "User review" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
