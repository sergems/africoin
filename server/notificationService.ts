import type { notifications } from "../drizzle/schema";

type NotificationInsert = typeof notifications.$inferInsert;

export function buildFundingDecisionNotification(input: {
  userId: number;
  type: "deposit" | "withdrawal";
  decision: "approve" | "reject";
  reference: string;
  note: string;
}): NotificationInsert {
  return {
    userId: input.userId,
    type: input.type,
    title: input.decision === "approve" ? "Demande approuvée" : "Demande rejetée",
    message: `${input.reference} · ${input.note}`,
  };
}
