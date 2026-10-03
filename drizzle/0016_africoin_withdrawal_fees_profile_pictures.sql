CREATE TABLE `africoin_fee_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`withdrawalRequestId` int NOT NULL,
	`userId` int NOT NULL,
	`withdrawalReference` varchar(120) NOT NULL,
	`grossAmount` decimal(24,8) NOT NULL,
	`feeAmount` decimal(24,8) NOT NULL,
	`payoutAmount` decimal(24,8) NOT NULL,
	`currency` enum('CDF','USD') NOT NULL,
	`externalPayoutReference` varchar(180) NOT NULL,
	`recordedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `africoin_fee_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `africoin_fee_transactions_withdrawalRequestId_unique` UNIQUE(`withdrawalRequestId`),
	CONSTRAINT `africoin_fee_transactions_withdrawalReference_unique` UNIQUE(`withdrawalReference`)
);
--> statement-breakpoint
ALTER TABLE `client_profiles` ADD `avatarStorageKey` varchar(512);--> statement-breakpoint
ALTER TABLE `withdrawal_requests` ADD `feeAmount` decimal(24,8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `withdrawal_requests` ADD `payoutAmount` decimal(24,8) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE `withdrawal_requests` SET `payoutAmount` = `amount` WHERE `payoutAmount` = 0 AND `amount` > 0;--> statement-breakpoint
ALTER TABLE `withdrawal_requests` ADD `payoutCompletedAt` timestamp;
