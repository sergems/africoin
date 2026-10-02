ALTER TABLE `deposit_requests` ADD `paymentProvider` varchar(40);--> statement-breakpoint
ALTER TABLE `deposit_requests` ADD `providerStatus` varchar(80);--> statement-breakpoint
ALTER TABLE `deposit_requests` ADD `providerCheckCount` int DEFAULT 0 NOT NULL;