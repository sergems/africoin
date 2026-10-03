import type { notifications } from "../drizzle/schema";

type NotificationInsert = typeof notifications.$inferInsert;

export function buildFundingDecisionNotification(input: {
  userId: number;
  type: "deposit" | "withdrawal";
  decision: "approve" | "reject";
  reference: string;
  note: string;
  amount?: string;
  feeAmount?: string;
  payoutAmount?: string;
  currency?: "CDF" | "USD";
}): NotificationInsert {
  if (input.type === "withdrawal" && input.decision === "approve") {
    return {
      userId: input.userId,
      type: "withdrawal",
      title: "Retrait approuvé · paiement à réaliser",
      message: `${input.reference} · ${input.note} Total réservé : ${input.amount ?? "—"} ${input.currency ?? ""}; frais Africoin : ${input.feeAmount ?? "—"} ${input.currency ?? ""}; montant net à verser : ${input.payoutAmount ?? "—"} ${input.currency ?? ""}. Aucun paiement n’est envoyé automatiquement; le versement externe doit être enregistré par Africoin.`,
    };
  }
  return {
    userId: input.userId,
    type: input.type,
    title: input.decision === "approve" ? "Demande approuvée" : "Demande rejetée",
    message: `${input.reference} · ${input.note}`,
  };
}

export function buildWithdrawalRequestNotification(input: {
  userId: number;
  reference: string;
  amount: string;
  feeAmount: string;
  payoutAmount: string;
  currency: "CDF" | "USD";
}): NotificationInsert {
  return {
    userId: input.userId,
    type: "withdrawal",
    title: "Demande de retrait enregistrée",
    message: `Débit total ${input.amount} ${input.currency} · frais Africoin (2,5 %) ${input.feeAmount} ${input.currency} · net à verser ${input.payoutAmount} ${input.currency} · ${input.reference} · en attente d’approbation; le solde sera réservé à l’approbation.`,
  };
}

export function buildWithdrawalCancelledNotification(input: {
  userId: number;
  reference: string;
  amount: string;
  currency: "CDF" | "USD";
  note: string;
}): NotificationInsert {
  return {
    userId: input.userId,
    type: "withdrawal",
    title: "Retrait annulé · solde libéré",
    message: `${input.reference} · ${input.amount} ${input.currency} libérés. Aucun frais n’a été prélevé. ${input.note}`,
  };
}
