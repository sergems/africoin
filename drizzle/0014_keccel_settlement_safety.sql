ALTER TABLE `idempotency_keys` DROP INDEX `idempotency_keys_key_unique`;--> statement-breakpoint
ALTER TABLE `deposit_requests` ADD `candidateTransactionId` varchar(180);--> statement-breakpoint
ALTER TABLE `deposit_requests` ADD `statusCheckNotBefore` timestamp(3);--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_user_key_operation_unique` UNIQUE(`userId`,`key`,`operation`);