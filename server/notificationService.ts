import type { notifications } from "../drizzle/schema";

type NotificationInsert = typeof notifications.$inferInsert;

export function buildFundingDecisionNotification(input: {
  userId: number;
  type: "deposit" | "withdrawal";
  decision: "approve" | "reject";
  reference: string;
  note: string;
}): NotificationInsert {
  if (input.type === "withdrawal" && input.decision === "approve") {
    return {
      userId: input.userId,
      type: "withdrawal",
      title: "Retrait approuvé · transfert non envoyé",
      message: `${input.reference} · ${input.note} Aucun fonds n’a été réservé ou transféré; le payout Keccel reste désactivé.`,
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
  currency: "CDF" | "USD";
}): NotificationInsert {
  return {
    userId: input.userId,
    type: "withdrawal",
    title: "Demande de retrait enregistrée",
    message: `${input.amount} ${input.currency} · ${input.reference} · en attente d’approbation; aucun fonds n’a été réservé ni transféré.`,
  };
}
