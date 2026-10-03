export const WITHDRAWAL_FEE_RATE = 0.025;

export function calculateWithdrawalAmounts(totalDebit: number) {
  if (!Number.isFinite(totalDebit) || totalDebit <= 0) {
    throw new RangeError("Withdrawal total must be a positive finite amount.");
  }

  const totalMinorUnits = Math.round(totalDebit * 100);
  if (totalMinorUnits <= 0) throw new RangeError("Withdrawal total is below the supported currency precision.");

  // Withdrawal currencies use two decimal places; ties round up to one minor unit.
  const feeMinorUnits = Math.round(totalMinorUnits * WITHDRAWAL_FEE_RATE);
  const payoutMinorUnits = totalMinorUnits - feeMinorUnits;
  if (payoutMinorUnits <= 0) throw new RangeError("Withdrawal amount is too small after the Africoin fee.");

  return {
    totalDebit: (totalMinorUnits / 100).toFixed(2),
    feeAmount: (feeMinorUnits / 100).toFixed(2),
    payoutAmount: (payoutMinorUnits / 100).toFixed(2),
  };
}
