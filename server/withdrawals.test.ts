import { describe, expect, it } from "vitest";
import { isWithdrawalAwaitingAdminReview, resolveWithdrawalDecisionStatus } from "./withdrawals";

describe("withdrawal approval workflow", () => {
  it("requires an admin decision for requests awaiting review", () => {
    expect(isWithdrawalAwaitingAdminReview("pending_review")).toBe(true);
    expect(isWithdrawalAwaitingAdminReview("requested")).toBe(true);
    expect(isWithdrawalAwaitingAdminReview("approved_pending_payout")).toBe(false);
    expect(isWithdrawalAwaitingAdminReview("rejected")).toBe(false);
  });

  it("records approval as awaiting payout, never as an executed transfer", () => {
    expect(resolveWithdrawalDecisionStatus("approve")).toBe("approved_pending_payout");
    expect(resolveWithdrawalDecisionStatus("approve")).not.toBe("processing");
    expect(resolveWithdrawalDecisionStatus("approve")).not.toBe("completed");
  });

  it("records a rejected request as rejected", () => {
    expect(resolveWithdrawalDecisionStatus("reject")).toBe("rejected");
  });
});
