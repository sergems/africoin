CREATE TABLE `reconciliation_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestReference` varchar(120) NOT NULL,
	`entityType` enum('deposit','withdrawal') NOT NULL,
	`status` enum('unmatched','matched','exception','resolved') NOT NULL,
	`expectedAmount` decimal(24,8) NOT NULL,
	`settledAmount` decimal(24,8),
	`currency` enum('CDF','USD') NOT NULL,
	`providerReference` varchar(180),
	`reviewNote` text,
	`reviewedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reconciliation_history_id` PRIMARY KEY(`id`)
);
