import { describe, expect, it } from "vitest";
import { isTriggered } from "./internalBroker";

describe("Africoin internal broker triggers", () => {
  it("triggers buy limits below or at the market price", () => {
    expect(isTriggered({ orderType: "limit", side: "buy", limitPrice: "1.1000" }, 1.1)).toBe(true);
    expect(isTriggered({ orderType: "limit", side: "buy", limitPrice: "1.1000" }, 1.11)).toBe(false);
  });

  it("triggers sell limits and directional stop orders", () => {
    expect(isTriggered({ orderType: "limit", side: "sell", limitPrice: "1.1000" }, 1.11)).toBe(true);
    expect(isTriggered({ orderType: "stop", side: "buy", limitPrice: "1.1000" }, 1.11)).toBe(true);
    expect(isTriggered({ orderType: "stop", side: "sell", limitPrice: "1.1000" }, 1.09)).toBe(true);
  });
});
