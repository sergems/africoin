CREATE TABLE `idempotency_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`key` varchar(160) NOT NULL,
	`operation` varchar(80) NOT NULL,
	`response` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_keys_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestReference` varchar(120) NOT NULL,
	`providerReference` varchar(180),
	`entityType` enum('deposit','withdrawal','order') NOT NULL,
	`expectedAmount` decimal(24,8) NOT NULL,
	`settledAmount` decimal(24,8),
	`currency` enum('CDF','USD') NOT NULL,
	`status` enum('unmatched','matched','exception','resolved') NOT NULL DEFAULT 'unmatched',
	`reviewedBy` int,
	`reviewNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reconciliation_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `risk_limits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dailyDepositLimit` decimal(24,8) NOT NULL DEFAULT '100000',
	`dailyWithdrawalLimit` decimal(24,8) NOT NULL DEFAULT '100000',
	`orderNotionalLimit` decimal(24,8) NOT NULL DEFAULT '25000',
	`status` enum('active','restricted','blocked') NOT NULL DEFAULT 'active',
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `risk_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `risk_limits_userId_unique` UNIQUE(`userId`)
);
