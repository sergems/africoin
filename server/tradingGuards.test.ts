import { describe, expect, it } from "vitest";
import { evaluateTradingEligibility, resolveTradeExecutionMode } from "./tradingGuards";

const eligibleOrder = {
  riskStatus: "active",
  orderNotionalLimit: 100,
  walletStatus: "active",
  availableBalance: 100,
  notional: 10,
};

describe("evaluateTradingEligibility", () => {
  it("allows a user with pending KYC to trade when risk, wallet, balance, and order-limit checks pass", () => {
    expect(evaluateTradingEligibility(eligibleOrder)).toEqual({ allowed: true });
  });

  it("blocks restricted risk status without treating KYC as a trade gate", () => {
    expect(evaluateTradingEligibility({ ...eligibleOrder, riskStatus: "restricted" })).toMatchObject({ allowed: false, reason: "account_restricted" });
    expect(evaluateTradingEligibility({ ...eligibleOrder, riskStatus: "blocked" })).toMatchObject({ allowed: false, reason: "account_restricted" });
  });

  it("fails closed when the account risk limit is missing or invalid", () => {
    expect(evaluateTradingEligibility({ ...eligibleOrder, riskStatus: undefined })).toMatchObject({ allowed: false, reason: "account_restricted" });
    expect(evaluateTradingEligibility({ ...eligibleOrder, orderNotionalLimit: undefined })).toMatchObject({ allowed: false, reason: "risk_limit_unavailable" });
    expect(evaluateTradingEligibility({ ...eligibleOrder, orderNotionalLimit: 0 })).toMatchObject({ allowed: false, reason: "risk_limit_unavailable" });
  });

  it("blocks order notionals above the configured per-order limit", () => {
    expect(evaluateTradingEligibility({ ...eligibleOrder, notional: 100.01 })).toMatchObject({ allowed: false, reason: "order_limit_exceeded" });
    expect(evaluateTradingEligibility({ ...eligibleOrder, notional: 100 })).toEqual({ allowed: true });
  });

  it("blocks restricted wallets", () => {
    expect(evaluateTradingEligibility({ ...eligibleOrder, walletStatus: "restricted" })).toMatchObject({ allowed: false, reason: "wallet_restricted" });
  });

  it("blocks orders above the available balance", () => {
    expect(evaluateTradingEligibility({ ...eligibleOrder, availableBalance: 9.99 })).toMatchObject({ allowed: false, reason: "insufficient_balance" });
  });

  it("blocks invalid notionals", () => {
    expect(evaluateTradingEligibility({ ...eligibleOrder, notional: 0 })).toMatchObject({ allowed: false, reason: "invalid_notional" });
  });

  it("leaves broker activation independent from KYC", () => {
    expect(resolveTradeExecutionMode(false)).toBe("pending_activation");
    expect(resolveTradeExecutionMode(true)).toBe("broker");
  });
});
