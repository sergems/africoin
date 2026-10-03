import { describe, expect, it } from "vitest";
import { classifyKelpayCheckResponse, isKelpaySettlementEligible, toKelpayClientStatus } from "./kelpay";

const expected = {
  merchantCode: "AFRICOIN",
  reference: "DEP-ABC123",
  transactionId: "23071502050800000342",
  amount: "25.00000000",
  currency: "USD" as const,
};

function providerResult(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    merchantcode: expected.merchantCode,
    transactionid: expected.transactionId,
    reference: expected.reference,
    transactionstatus: "SUCCESS",
    amount: 25,
    currency: "USD",
    description: "Payment successful",
    ...overrides,
  };
}

describe("Africoin deposit status verification", () => {
  it("accepts only a matching successful CheckTransaction response", () => {
    expect(classifyKelpayCheckResponse(providerResult(), expected)).toMatchObject({
      kind: "success",
      transactionId: expected.transactionId,
      providerStatus: "SUCCESS",
    });
  });

  it("classifies a matching provider-reported failure without crediting", () => {
    expect(classifyKelpayCheckResponse(providerResult({ code: 1, transactionstatus: "FAILED" }), expected)).toMatchObject({
      kind: "failure",
      providerStatus: "FAILED",
    });
  });

  it("keeps non-final statuses pending", () => {
    expect(classifyKelpayCheckResponse(providerResult({ transactionstatus: "PROCESSING" }), expected)).toMatchObject({
      kind: "pending",
      providerStatus: "PROCESSING",
    });
  });

  it.each([
    ["merchantcode", "OTHER"],
    ["reference", "DEP-OTHER"],
    ["transactionid", "OTHER-ID"],
    ["amount", 24.99],
    ["currency", "CDF"],
  ])("flags a mismatched %s for reconciliation", (key, value) => {
    expect(classifyKelpayCheckResponse(providerResult({ [key]: value }), expected)).toMatchObject({
      kind: "exception",
      providerStatus: "VERIFICATION_EXCEPTION",
    });
  });

  it("does not accept contradictory or missing final status fields", () => {
    expect(classifyKelpayCheckResponse(providerResult({ code: 1, transactionstatus: "SUCCESS" }), expected).kind).toBe("exception");
    expect(classifyKelpayCheckResponse(providerResult({ code: 0, transactionstatus: "" }), expected).kind).toBe("exception");
  });

  it("keeps an unverified mismatched callback ID out of the verified result", () => {
    const result = classifyKelpayCheckResponse(providerResult({ transactionid: "untrusted-callback-id" }), expected);
    expect(result.kind).toBe("exception");
    expect(result).not.toHaveProperty("transactionId");
  });

  it("allows provider-confirmed deposits regardless of KYC status while retaining risk and wallet checks", () => {
    expect(isKelpaySettlementEligible("active", "active")).toBe(true);
    expect(isKelpaySettlementEligible(undefined, "active")).toBe(false);
    expect(isKelpaySettlementEligible("restricted", "active")).toBe(false);
    expect(isKelpaySettlementEligible("active", "restricted")).toBe(false);
    expect(isKelpaySettlementEligible("active", "closed")).toBe(false);
  });

  it("limits manual provider status checks and exposes a client-safe message", () => {
    expect(toKelpayClientStatus({ status: "processing", providerStatus: "REQUEST_ACCEPTED", providerCheckCount: 2, providerReference: expected.transactionId })).toMatchObject({
      statusChecksRemaining: 1,
      canCheckStatus: true,
      message: expect.stringContaining("Africoin"),
    });
    expect(toKelpayClientStatus({ status: "processing", providerStatus: "REQUEST_ACCEPTED", providerCheckCount: 3, providerReference: expected.transactionId }).canCheckStatus).toBe(false);
  });

  it("allows checking a callback candidate but never a compliance-held success", () => {
    expect(toKelpayClientStatus({ status: "processing", providerStatus: "CALLBACK_RECEIVED", candidateTransactionId: expected.transactionId }).canCheckStatus).toBe(true);
    expect(toKelpayClientStatus({ status: "pending_review", providerStatus: "SUCCESS_COMPLIANCE_HOLD", providerReference: expected.transactionId }).canCheckStatus).toBe(false);
  });
});
