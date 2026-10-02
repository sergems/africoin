import { describe, expect, it } from "vitest";
import { buildMarketStreamStatus, buildMarketStreamUpdate } from "./marketStream";

describe("market WebSocket stream contract", () => {
  it("advertises a safe pending-partner status by default", () => {
    const status = buildMarketStreamStatus(1700000000000);
    expect(status).toMatchObject({
      type: "market_status",
      transport: "websocket",
      providerState: "pending_activation",
      connected: false,
      asOf: 1700000000000,
    });
    expect(status.message).toContain("attente");
  });

  it("normalizes catalog quotes into a timestamped stream update", () => {
    const update = buildMarketStreamUpdate([
      {
        id: "101",
        symbol: "AAPL",
        name: "Apple Inc.",
        assetClass: "equity",
        exchange: "NASDAQ",
        baseCurrency: "USD",
        quoteCurrency: "USD",
        price: 227.16,
        changePercent: 0.72,
        riskLevel: "medium",
        provider: "pending_activation",
      },
    ], 1700000000000);
    expect(update).toMatchObject({ type: "market_update", source: "pending_activation", asOf: 1700000000000 });
    expect(update.items[0]).toMatchObject({ id: 101, symbol: "AAPL", price: "227.16", changePercent: "0.72", asOf: 1700000000000 });
  });

  it("supports an empty safe fallback without inventing quote rows", () => {
    expect(buildMarketStreamUpdate([], 1700000000000).items).toEqual([]);
  });
});
