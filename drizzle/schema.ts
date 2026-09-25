import {
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "compliance", "admin", "super_admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const localCredentials = mysqlTable("local_credentials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  verificationTokenHash: varchar("verificationTokenHash", { length: 128 }),
  verificationExpiresAt: timestamp("verificationExpiresAt"),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const clientProfiles = mysqlTable("client_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  phone: varchar("phone", { length: 40 }),
  country: varchar("country", { length: 80 }).default("RDC").notNull(),
  dateOfBirth: varchar("dateOfBirth", { length: 10 }),
  address: varchar("address", { length: 255 }),
  city: varchar("city", { length: 100 }),
  occupation: varchar("occupation", { length: 120 }),
  sourceOfFunds: mysqlEnum("sourceOfFunds", ["salary", "business", "investments", "savings", "inheritance", "other"]),
  preferredCurrency: mysqlEnum("preferredCurrency", ["CDF", "USD"]).default("USD").notNull(),
  investorExperience: mysqlEnum("investorExperience", ["none", "beginner", "intermediate", "advanced"]).default("none").notNull(),
  riskProfile: mysqlEnum("riskProfile", ["unassessed", "conservative", "balanced", "growth", "speculative"]).default("unassessed").notNull(),
  riskScore: int("riskScore"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const kycCases = mysqlTable("kyc_cases", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["not_started", "pending", "in_review", "approved", "rejected", "needs_action", "blocked"]).default("not_started").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const kycDocuments = mysqlTable("kyc_documents", {
  id: int("id").autoincrement().primaryKey(),
  kycCaseId: int("kycCaseId").notNull(),
  documentType: mysqlEnum("documentType", ["identity", "address", "source_of_funds", "corporate", "other"]).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["uploaded", "accepted", "rejected"]).default("uploaded").notNull(),
  reviewerNote: text("reviewerNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const wallets = mysqlTable("wallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  availableBalance: decimal("availableBalance", { precision: 24, scale: 8 }).default("0").notNull(),
  pendingBalance: decimal("pendingBalance", { precision: 24, scale: 8 }).default("0").notNull(),
  status: mysqlEnum("status", ["active", "restricted", "closed"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const walletTransactions = mysqlTable("wallet_transactions", {
  id: int("id").autoincrement().primaryKey(),
  walletId: int("walletId").notNull(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["deposit", "withdrawal", "trade_debit", "trade_credit", "fee", "adjustment"]).notNull(),
  direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
  amount: decimal("amount", { precision: 24, scale: 8 }).notNull(),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  status: mysqlEnum("status", ["pending", "completed", "failed", "reversed", "blocked"]).default("pending").notNull(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  providerReference: varchar("providerReference", { length: 180 }),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export const depositRequests = mysqlTable("deposit_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  walletId: int("walletId").notNull(),
  amount: decimal("amount", { precision: 24, scale: 8 }).notNull(),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  method: mysqlEnum("method", ["bank_transfer", "mobile_money", "card", "partner"]).notNull(),
  status: mysqlEnum("status", ["requested", "pending_review", "processing", "completed", "rejected", "failed"]).default("requested").notNull(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  providerReference: varchar("providerReference", { length: 180 }),
  complianceNote: text("complianceNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const withdrawalRequests = mysqlTable("withdrawal_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  walletId: int("walletId").notNull(),
  amount: decimal("amount", { precision: 24, scale: 8 }).notNull(),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  destinationType: mysqlEnum("destinationType", ["bank_account", "mobile_money", "partner"]).notNull(),
  status: mysqlEnum("status", ["requested", "pending_review", "processing", "completed", "rejected", "failed", "blocked"]).default("requested").notNull(),
  reference: varchar("reference", { length: 120 }).notNull().unique(),
  providerReference: varchar("providerReference", { length: 180 }),
  complianceNote: text("complianceNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const instruments = mysqlTable("instruments", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  assetClass: mysqlEnum("assetClass", ["equity", "fx_spot"]).notNull(),
  exchange: varchar("exchange", { length: 80 }),
  baseCurrency: varchar("baseCurrency", { length: 8 }).notNull(),
  quoteCurrency: varchar("quoteCurrency", { length: 8 }).notNull(),
  status: mysqlEnum("status", ["active", "disabled", "pending_approval"]).default("active").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high"]).default("medium").notNull(),
  price: decimal("price", { precision: 24, scale: 8 }).default("0").notNull(),
  changePercent: decimal("changePercent", { precision: 12, scale: 4 }).default("0").notNull(),
  provider: varchar("provider", { length: 80 }).default("pending_activation").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const watchlists = mysqlTable("watchlists", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 80 }).default("Ma liste").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const watchlistItems = mysqlTable("watchlist_items", {
  id: int("id").autoincrement().primaryKey(),
  watchlistId: int("watchlistId").notNull(),
  instrumentId: int("instrumentId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const priceSnapshots = mysqlTable("price_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  instrumentId: int("instrumentId").notNull(),
  price: decimal("price", { precision: 24, scale: 8 }).notNull(),
  changePercent: decimal("changePercent", { precision: 12, scale: 4 }).notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  instrumentId: int("instrumentId").notNull(),
  side: mysqlEnum("side", ["buy", "sell"]).notNull(),
  orderType: mysqlEnum("orderType", ["market", "limit"]).default("market").notNull(),
  quantity: decimal("quantity", { precision: 24, scale: 8 }).notNull(),
  limitPrice: decimal("limitPrice", { precision: 24, scale: 8 }),
  filledQuantity: decimal("filledQuantity", { precision: 24, scale: 8 }).default("0").notNull(),
  averagePrice: decimal("averagePrice", { precision: 24, scale: 8 }),
  status: mysqlEnum("status", ["pending_approval", "submitted", "partially_filled", "filled", "cancelled", "rejected", "blocked"]).default("pending_approval").notNull(),
  executionMode: mysqlEnum("executionMode", ["pending_activation", "broker"]).default("pending_activation").notNull(),
  providerReference: varchar("providerReference", { length: 180 }),
  rejectionReason: text("rejectionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  executedAt: timestamp("executedAt"),
});

export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  instrumentId: int("instrumentId").notNull(),
  quantity: decimal("quantity", { precision: 24, scale: 8 }).default("0").notNull(),
  averageCost: decimal("averageCost", { precision: 24, scale: 8 }).default("0").notNull(),
  unrealizedPnl: decimal("unrealizedPnl", { precision: 24, scale: 8 }).default("0").notNull(),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["kyc", "deposit", "withdrawal", "order", "compliance", "system"]).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  message: text("message").notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId"),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: varchar("entityId", { length: 80 }),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("info").notNull(),
  metadata: text("metadata"),
  ipAddress: varchar("ipAddress", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const adminApprovalRequests = mysqlTable("admin_approval_requests", {
  id: int("id").autoincrement().primaryKey(),
  actionType: varchar("actionType", { length: 80 }).notNull(),
  targetType: varchar("targetType", { length: 80 }).notNull(),
  targetId: varchar("targetId", { length: 80 }).notNull(),
  payload: text("payload").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "expired", "executed"]).default("pending").notNull(),
  requestedBy: int("requestedBy").notNull(),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const adminApprovalDecisions = mysqlTable("admin_approval_decisions", {
  id: int("id").autoincrement().primaryKey(),
  requestId: int("requestId").notNull(),
  approverId: int("approverId").notNull(),
  decision: mysqlEnum("decision", ["approved", "rejected"]).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const complianceAlerts = mysqlTable("compliance_alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  type: mysqlEnum("type", ["velocity", "sanctions", "pep", "source_of_funds", "device", "manual"]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  status: mysqlEnum("status", ["open", "investigating", "resolved", "dismissed"]).default("open").notNull(),
  description: text("description").notNull(),
  assignedTo: int("assignedTo"),
  resolutionNote: text("resolutionNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const legalDocuments = mysqlTable("legal_documents", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  title: varchar("title", { length: 180 }).notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  content: text("content").notNull(),
  isRequired: int("isRequired").default(1).notNull(),
  publishedAt: timestamp("publishedAt").defaultNow().notNull(),
});

export const legalAcceptances = mysqlTable("legal_acceptances", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  legalDocumentId: int("legalDocumentId").notNull(),
  acceptedAt: timestamp("acceptedAt").defaultNow().notNull(),
  ipAddress: varchar("ipAddress", { length: 64 }),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const reconciliationRecords = mysqlTable("reconciliation_records", {
  id: int("id").autoincrement().primaryKey(),
  requestReference: varchar("requestReference", { length: 120 }).notNull(),
  providerReference: varchar("providerReference", { length: 180 }),
  entityType: mysqlEnum("entityType", ["deposit", "withdrawal", "order"]).notNull(),
  expectedAmount: decimal("expectedAmount", { precision: 24, scale: 8 }).notNull(),
  settledAmount: decimal("settledAmount", { precision: 24, scale: 8 }),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  status: mysqlEnum("status", ["unmatched", "matched", "exception", "resolved"]).default("unmatched").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const riskLimits = mysqlTable("risk_limits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  dailyDepositLimit: decimal("dailyDepositLimit", { precision: 24, scale: 8 }).default("100000").notNull(),
  dailyWithdrawalLimit: decimal("dailyWithdrawalLimit", { precision: 24, scale: 8 }).default("100000").notNull(),
  orderNotionalLimit: decimal("orderNotionalLimit", { precision: 24, scale: 8 }).default("25000").notNull(),
  status: mysqlEnum("status", ["active", "restricted", "blocked"]).default("active").notNull(),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const idempotencyKeys = mysqlTable("idempotency_keys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  key: varchar("key", { length: 160 }).notNull().unique(),
  operation: varchar("operation", { length: 80 }).notNull(),
  response: text("response"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});


export const reconciliationHistory = mysqlTable("reconciliation_history", {
  id: int("id").autoincrement().primaryKey(),
  requestReference: varchar("requestReference", { length: 120 }).notNull(),
  entityType: mysqlEnum("entityType", ["deposit", "withdrawal"]).notNull(),
  status: mysqlEnum("status", ["unmatched", "matched", "exception", "resolved"]).notNull(),
  expectedAmount: decimal("expectedAmount", { precision: 24, scale: 8 }).notNull(),
  settledAmount: decimal("settledAmount", { precision: 24, scale: 8 }),
  currency: mysqlEnum("currency", ["CDF", "USD"]).notNull(),
  providerReference: varchar("providerReference", { length: 180 }),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
