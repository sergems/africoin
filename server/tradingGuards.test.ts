import { describe, expect, it } from "vitest";
import { evaluateTradingEligibility } from "./tradingGuards";

describe("evaluateTradingEligibility", () => {
  it("blocks accounts that have not received KYC approval", () => {
    expect(evaluateTradingEligibility({ kycStatus: "pending", walletStatus: "active", availableBalance: 100, notional: 10 })).toMatchObject({ allowed: false, reason: "kyc_pending" });
  });

  it("blocks restricted wallets", () => {
    expect(evaluateTradingEligibility({ kycStatus: "approved", walletStatus: "restricted", availableBalance: 100, notional: 10 })).toMatchObject({ allowed: false, reason: "wallet_restricted" });
  });

  it("blocks orders above the available balance", () => {
    expect(evaluateTradingEligibility({ kycStatus: "approved", walletStatus: "active", availableBalance: 9.99, notional: 10 })).toMatchObject({ allowed: false, reason: "insufficient_balance" });
  });

  it("allows an approved user with enough available balance", () => {
    expect(evaluateTradingEligibility({ kycStatus: "approved", walletStatus: "active", availableBalance: 100, notional: 10 })).toEqual({ allowed: true });
  });
});
