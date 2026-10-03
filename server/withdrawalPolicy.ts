import { calculateWithdrawalAmounts, WITHDRAWAL_FEE_RATE } from "../shared/withdrawalFees";

export { calculateWithdrawalAmounts, WITHDRAWAL_FEE_RATE };

export const REQUIRED_WITHDRAWAL_DOCUMENTS = [
  "identity",
  "address",
  "source_of_funds",
] as const;

export type RequiredWithdrawalDocument = typeof REQUIRED_WITHDRAWAL_DOCUMENTS[number];

export type WithdrawalDocumentStatus = {
  documentType: string;
  status: string;
};

export type WithdrawalEligibilityInput = {
  kycStatus?: string | null;
  documents: WithdrawalDocumentStatus[];
  riskStatus?: string | null;
  walletStatus?: string | null;
};

export type WithdrawalEligibility =
  | { eligible: true; reason: null; missingDocuments: [] }
  | { eligible: false; reason: "kyc_pending" | "documents_pending" | "account_restricted" | "wallet_restricted"; missingDocuments: RequiredWithdrawalDocument[] };

export function evaluateWithdrawalEligibility(input: WithdrawalEligibilityInput): WithdrawalEligibility {
  if (input.kycStatus !== "approved") {
    return { eligible: false, reason: "kyc_pending", missingDocuments: [] };
  }

  // The input must be ordered newest-first; a pending/rejected replacement
  // supersedes an older accepted copy of the same document type.
  const latestByType = new Map<string, string>();
  for (const document of input.documents) {
    if (!latestByType.has(document.documentType)) latestByType.set(document.documentType, document.status);
  }
  const missingDocuments = REQUIRED_WITHDRAWAL_DOCUMENTS.filter(type => latestByType.get(type) !== "accepted");
  if (missingDocuments.length) {
    return { eligible: false, reason: "documents_pending", missingDocuments };
  }
  if (input.riskStatus !== "active") {
    return { eligible: false, reason: "account_restricted", missingDocuments: [] };
  }
  if (input.walletStatus !== "active") {
    return { eligible: false, reason: "wallet_restricted", missingDocuments: [] };
  }
  return { eligible: true, reason: null, missingDocuments: [] };
}

export function describeWithdrawalEligibility(result: WithdrawalEligibility) {
  if (result.eligible) return "Votre compte peut effectuer un retrait.";
  if (result.reason === "kyc_pending") return "Votre dossier KYC doit être approuvé avant tout retrait.";
  if (result.reason === "documents_pending") {
    const labels: Record<RequiredWithdrawalDocument, string> = {
      identity: "pièce d’identité",
      address: "justificatif de domicile",
      source_of_funds: "justificatif de source des fonds",
    };
    return `Documents requis manquants ou non acceptés : ${result.missingDocuments.map(type => labels[type]).join(", ")}.`;
  }
  if (result.reason === "account_restricted") return "Votre compte ou vos limites sont restreints par la conformité.";
  return "Votre portefeuille est indisponible pour les retraits.";
}
