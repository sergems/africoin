export type TradingEligibilityInput = {
  kycStatus?: string | null;
  walletStatus?: string | null;
  availableBalance: number;
  notional: number;
};

export type TradingEligibilityResult =
  | { allowed: true }
  | { allowed: false; reason: "kyc_pending" | "wallet_restricted" | "insufficient_balance" | "invalid_notional"; message: string };

export function resolveTradeExecutionMode(brokerConnected: boolean) {
  return brokerConnected ? "broker" as const : "pending_activation" as const;
}

export function evaluateTradingEligibility(input: TradingEligibilityInput): TradingEligibilityResult {
  if (input.kycStatus !== "approved") {
    return {
      allowed: false,
      reason: "kyc_pending",
      message: "Votre compte doit être approuvé par la conformité avant toute opération de trading.",
    };
  }

  if (input.walletStatus !== "active") {
    return {
      allowed: false,
      reason: "wallet_restricted",
      message: "Votre portefeuille est indisponible pour le trading.",
    };
  }

  if (!Number.isFinite(input.notional) || input.notional <= 0) {
    return {
      allowed: false,
      reason: "invalid_notional",
      message: "La valeur de l’ordre est invalide.",
    };
  }

  if (!Number.isFinite(input.availableBalance) || input.availableBalance < input.notional) {
    return {
      allowed: false,
      reason: "insufficient_balance",
      message: "Solde disponible insuffisant pour couvrir cet ordre.",
    };
  }

  return { allowed: true };
}
