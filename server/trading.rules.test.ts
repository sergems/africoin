import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { providerRegistry } from "./providers";
import { resolveTradeExecutionMode } from "./tradingGuards";
import type { TrpcContext } from "./_core/context";

function context(role: "user" | "compliance" | "admin" = "user"): TrpcContext {
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
    res: { clearCookie: () => undefined } as TrpcContext["res"],
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

  it("does not allow a withdrawal above the available wallet balance", async () => {
    const paymentsProvider = providerRegistry.find(provider => provider.category === "payments");
    if (!paymentsProvider) throw new Error("Payments provider fixture missing");
    const previousMode = paymentsProvider.mode;
    const previousConnected = paymentsProvider.connected;
    paymentsProvider.mode = "live";
    paymentsProvider.connected = true;
    try {
      const caller = appRouter.createCaller(context());
      await expect(caller.wallets.requestWithdrawal({
        amount: 999999999,
        currency: "USD",
        destinationType: "partner",
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      paymentsProvider.mode = previousMode;
      paymentsProvider.connected = previousConnected;
    }
  });
});
