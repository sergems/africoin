export type TradingEligibilityInput = {
  riskStatus?: string | null;
  orderNotionalLimit?: number;
  walletStatus?: string | null;
  availableBalance: number;
  notional: number;
};

export type TradingEligibilityResult =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "account_restricted"
        | "risk_limit_unavailable"
        | "order_limit_exceeded"
        | "wallet_restricted"
        | "insufficient_balance"
        | "invalid_notional";
      message: string;
    };

export function resolveTradeExecutionMode(brokerConnected: boolean) {
  return brokerConnected ? "broker" as const : "pending_activation" as const;
}

export function evaluateTradingEligibility(input: TradingEligibilityInput): TradingEligibilityResult {
  if (!Number.isFinite(input.notional) || input.notional <= 0) {
    return {
      allowed: false,
      reason: "invalid_notional",
      message: "La valeur de l’ordre est invalide.",
    };
  }

  if (input.riskStatus !== "active") {
    return {
      allowed: false,
      reason: "account_restricted",
      message: "Votre compte est restreint par la conformité.",
    };
  }

  if (!Number.isFinite(input.orderNotionalLimit) || Number(input.orderNotionalLimit) <= 0) {
    return {
      allowed: false,
      reason: "risk_limit_unavailable",
      message: "La limite de risque de votre compte est indisponible.",
    };
  }

  if (input.notional > Number(input.orderNotionalLimit)) {
    return {
      allowed: false,
      reason: "order_limit_exceeded",
      message: "La valeur de cet ordre dépasse la limite autorisée pour votre compte.",
    };
  }

  if (input.walletStatus !== "active") {
    return {
      allowed: false,
      reason: "wallet_restricted",
      message: "Votre portefeuille est indisponible pour le trading.",
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
