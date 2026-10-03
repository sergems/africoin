import { describe, expect, it } from "vitest";
import { calculateWithdrawalAmounts, evaluateWithdrawalEligibility } from "./withdrawalPolicy";

const acceptedDocuments = [
  { documentType: "identity", status: "accepted" },
  { documentType: "address", status: "accepted" },
  { documentType: "source_of_funds", status: "accepted" },
];

describe("withdrawal policy", () => {
  it("deducts a rounded 2.5 percent fee from the total debit", () => {
    expect(calculateWithdrawalAmounts(100)).toEqual({ totalDebit: "100.00", feeAmount: "2.50", payoutAmount: "97.50" });
    expect(calculateWithdrawalAmounts(19.99)).toEqual({ totalDebit: "19.99", feeAmount: "0.50", payoutAmount: "19.49" });
  });

  it("requires an approved KYC case before withdrawal", () => {
    expect(evaluateWithdrawalEligibility({ kycStatus: "pending", documents: acceptedDocuments, riskStatus: "active", walletStatus: "active" })).toMatchObject({ eligible: false, reason: "kyc_pending" });
  });

  it("requires each core document to have an accepted latest review", () => {
    expect(evaluateWithdrawalEligibility({ kycStatus: "approved", documents: acceptedDocuments.slice(0, 2), riskStatus: "active", walletStatus: "active" })).toMatchObject({ eligible: false, reason: "documents_pending", missingDocuments: ["source_of_funds"] });
    expect(evaluateWithdrawalEligibility({ kycStatus: "approved", documents: [{ ...acceptedDocuments[0], status: "uploaded" }, { ...acceptedDocuments[0], status: "accepted" }, ...acceptedDocuments.slice(1)], riskStatus: "active", walletStatus: "active" })).toMatchObject({ eligible: false, reason: "documents_pending", missingDocuments: ["identity"] });
  });

  it("requires active risk/account controls and an active wallet", () => {
    expect(evaluateWithdrawalEligibility({ kycStatus: "approved", documents: acceptedDocuments, riskStatus: "restricted", walletStatus: "active" })).toMatchObject({ eligible: false, reason: "account_restricted" });
    expect(evaluateWithdrawalEligibility({ kycStatus: "approved", documents: acceptedDocuments, riskStatus: "active", walletStatus: "closed" })).toMatchObject({ eligible: false, reason: "wallet_restricted" });
  });

  it("permits withdrawal when KYC, latest documents, limits, and wallet are all valid", () => {
    expect(evaluateWithdrawalEligibility({ kycStatus: "approved", documents: acceptedDocuments, riskStatus: "active", walletStatus: "active" })).toEqual({ eligible: true, reason: null, missingDocuments: [] });
  });
});
