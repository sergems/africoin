CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int,
	`action` varchar(120) NOT NULL,
	`entityType` varchar(80) NOT NULL,
	`entityId` varchar(80),
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`metadata` text,
	`ipAddress` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `client_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`phone` varchar(40),
	`country` varchar(80) NOT NULL DEFAULT 'RDC',
	`preferredCurrency` enum('CDF','USD') NOT NULL DEFAULT 'USD',
	`investorExperience` enum('none','beginner','intermediate','advanced') NOT NULL DEFAULT 'none',
	`riskProfile` enum('unassessed','conservative','balanced','growth','speculative') NOT NULL DEFAULT 'unassessed',
	`riskScore` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `client_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_profiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `compliance_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`type` enum('velocity','sanctions','pep','source_of_funds','device','manual') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`status` enum('open','investigating','resolved','dismissed') NOT NULL DEFAULT 'open',
	`description` text NOT NULL,
	`assignedTo` int,
	`resolutionNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `compliance_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deposit_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`walletId` int NOT NULL,
	`amount` decimal(24,8) NOT NULL,
	`currency` enum('CDF','USD') NOT NULL,
	`method` enum('bank_transfer','mobile_money','card','partner') NOT NULL,
	`status` enum('requested','pending_review','processing','completed','rejected','failed') NOT NULL DEFAULT 'requested',
	`reference` varchar(120) NOT NULL,
	`providerReference` varchar(180),
	`complianceNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deposit_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `deposit_requests_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(32) NOT NULL,
	`name` varchar(160) NOT NULL,
	`assetClass` enum('equity','fx_spot') NOT NULL,
	`exchange` varchar(80),
	`baseCurrency` varchar(8) NOT NULL,
	`quoteCurrency` varchar(8) NOT NULL,
	`status` enum('active','disabled','pending_approval') NOT NULL DEFAULT 'active',
	`riskLevel` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`price` decimal(24,8) NOT NULL DEFAULT '0',
	`changePercent` decimal(12,4) NOT NULL DEFAULT '0',
	`provider` varchar(80) NOT NULL DEFAULT 'demo',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `instruments_id` PRIMARY KEY(`id`),
	CONSTRAINT `instruments_symbol_unique` UNIQUE(`symbol`)
);
--> statement-breakpoint
CREATE TABLE `kyc_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('not_started','pending','in_review','approved','rejected','needs_action','blocked') NOT NULL DEFAULT 'not_started',
	`riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`reviewNote` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kyc_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kyc_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kycCaseId` int NOT NULL,
	`documentType` enum('identity','address','source_of_funds','corporate','other') NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`mimeType` varchar(120) NOT NULL,
	`status` enum('uploaded','accepted','rejected') NOT NULL DEFAULT 'uploaded',
	`reviewerNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kyc_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `legal_acceptances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`legalDocumentId` int NOT NULL,
	`acceptedAt` timestamp NOT NULL DEFAULT (now()),
	`ipAddress` varchar(64),
	CONSTRAINT `legal_acceptances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(80) NOT NULL,
	`title` varchar(180) NOT NULL,
	`version` varchar(32) NOT NULL,
	`content` text NOT NULL,
	`isRequired` int NOT NULL DEFAULT 1,
	`publishedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `legal_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_documents_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('kyc','deposit','withdrawal','order','compliance','system') NOT NULL,
	`title` varchar(160) NOT NULL,
	`message` text NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`instrumentId` int NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`orderType` enum('market','limit') NOT NULL DEFAULT 'market',
	`quantity` decimal(24,8) NOT NULL,
	`limitPrice` decimal(24,8),
	`filledQuantity` decimal(24,8) NOT NULL DEFAULT '0',
	`averagePrice` decimal(24,8),
	`status` enum('pending_approval','submitted','partially_filled','filled','cancelled','rejected','blocked') NOT NULL DEFAULT 'pending_approval',
	`executionMode` enum('demo','broker') NOT NULL DEFAULT 'demo',
	`providerReference` varchar(180),
	`rejectionReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`executedAt` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`instrumentId` int NOT NULL,
	`quantity` decimal(24,8) NOT NULL DEFAULT '0',
	`averageCost` decimal(24,8) NOT NULL DEFAULT '0',
	`unrealizedPnl` decimal(24,8) NOT NULL DEFAULT '0',
	`currency` enum('CDF','USD') NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instrumentId` int NOT NULL,
	`price` decimal(24,8) NOT NULL,
	`changePercent` decimal(12,4) NOT NULL,
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`walletId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('deposit','withdrawal','trade_debit','trade_credit','fee','adjustment') NOT NULL,
	`direction` enum('credit','debit') NOT NULL,
	`amount` decimal(24,8) NOT NULL,
	`currency` enum('CDF','USD') NOT NULL,
	`status` enum('pending','completed','failed','reversed','blocked') NOT NULL DEFAULT 'pending',
	`reference` varchar(120) NOT NULL,
	`providerReference` varchar(180),
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `wallet_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `wallet_transactions_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`currency` enum('CDF','USD') NOT NULL,
	`availableBalance` decimal(24,8) NOT NULL DEFAULT '0',
	`pendingBalance` decimal(24,8) NOT NULL DEFAULT '0',
	`status` enum('active','restricted','closed') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wallets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`watchlistId` int NOT NULL,
	`instrumentId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watchlist_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `watchlists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(80) NOT NULL DEFAULT 'Ma liste',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `watchlists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `withdrawal_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`walletId` int NOT NULL,
	`amount` decimal(24,8) NOT NULL,
	`currency` enum('CDF','USD') NOT NULL,
	`destinationType` enum('bank_account','mobile_money','partner') NOT NULL,
	`status` enum('requested','pending_review','processing','completed','rejected','failed','blocked') NOT NULL DEFAULT 'requested',
	`reference` varchar(120) NOT NULL,
	`providerReference` varchar(180),
	`complianceNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `withdrawal_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `withdrawal_requests_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','compliance','admin') NOT NULL DEFAULT 'user';