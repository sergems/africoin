export type ProviderMode = "pending_activation" | "live";

export type ProviderStatus = {
  name: string;
  category: "payments" | "fx" | "brokerage" | "custody" | "market_data";
  mode: ProviderMode;
  connected: boolean;
  activationRequirements: string[];
};

export interface PaymentProvider {
  createDeposit(input: { reference: string; amount: string; currency: "CDF" | "USD" }): Promise<{ providerReference: string; status: "pending" | "completed" }>;
  createWithdrawal(input: { reference: string; amount: string; currency: "CDF" | "USD" }): Promise<{ providerReference: string; status: "pending" | "completed" }>;
}

export interface BrokerageProvider {
  submitSpotOrder(input: { symbol: string; side: "buy" | "sell"; quantity: string; orderType: "market" | "limit"; limitPrice?: string }): Promise<{ providerReference: string; status: "submitted" | "filled" | "rejected" }>;
}

export interface MarketDataProvider {
  getQuote(symbol: string): Promise<{ symbol: string; price: string; changePercent: string; asOf: Date }>;
}

export interface CustodyProvider {
  getPositions(accountReference: string): Promise<Array<{ symbol: string; quantity: string; averageCost: string }>>;
}

export const providerRegistry: ProviderStatus[] = [
  { name: "Partenaire de paiement", category: "payments", mode: "pending_activation", connected: false, activationRequirements: ["Contrat partenaire agréé", "Identifiants API de production", "Webhooks signés", "Validation conformité"] },
  { name: "Africoin Internal Broker", category: "brokerage", mode: "live", connected: true, activationRequirements: [] },
  { name: "Fournisseur FX", category: "fx", mode: "pending_activation", connected: false, activationRequirements: ["Accord de liquidité", "Cadre de change validé", "Limites de risque", "Webhooks de statut"] },
  { name: "Dépositaire / custody", category: "custody", mode: "pending_activation", connected: false, activationRequirements: ["Convention de conservation", "Mapping des comptes", "Réconciliation quotidienne"] },
  { name: "Données de marché", category: "market_data", mode: "pending_activation", connected: false, activationRequirements: ["Licence de données", "Clé API", "Limites de débit", "Politique d’attribution des cours"] },
];

export function getProviderRegistry() {
  return providerRegistry.map(provider => ({ ...provider, activationRequirements: [...provider.activationRequirements] }));
}
