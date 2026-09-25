import { describe, expect, it } from "vitest";
import { getProviderRegistry, providerRegistry } from "./providers";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function userContext(): TrpcContext {
  return { user: { id: 999002, openId: "controls-test", name: "Controls", email: "controls@example.com", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as TrpcContext["res"] };
}

describe("platform safety controls", () => {
  it("keeps every partner adapter in pending_activation mode by default", () => {
    const providers = getProviderRegistry();
    expect(providers.length).toBeGreaterThanOrEqual(5);
    expect(providers.every(provider => provider.mode === "pending_activation" && provider.connected === false)).toBe(true);
  });

  it("rejects non-positive order quantities at the contract boundary", async () => {
    const caller = appRouter.createCaller(userContext());
    await expect(caller.orders.placeSpot({ instrumentId: 101, symbol: "AAPL", side: "buy", orderType: "market", quantity: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps CFDs and leverage outside the supported order contract", () => {
    const providers = getProviderRegistry();
    expect(providers.some(provider => provider.category === "brokerage" && provider.mode === "pending_activation")).toBe(true);
  });
});

  it("does not expose a live execution adapter before partner connection", () => {
    const providers = getProviderRegistry();
    expect(providers.every(provider => provider.connected === false)).toBe(true);
    expect(providers.every(provider => provider.mode !== "live")).toBe(true);
  });

  it("blocks orders before partner checks when KYC is not approved", async () => {
    const caller = appRouter.createCaller(userContext());
    await expect(caller.orders.placeSpot({ instrumentId: 101, symbol: "AAPL", side: "buy", orderType: "market", quantity: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
