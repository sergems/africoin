ALTER TABLE `orders` MODIFY COLUMN `orderType` enum('market','limit','stop') NOT NULL DEFAULT 'market';
--> statement-breakpoint
ALTER TABLE `orders` ADD `stopLoss` decimal(24,8);
--> statement-breakpoint
ALTER TABLE `orders` ADD `takeProfit` decimal(24,8);
--> statement-breakpoint
ALTER TABLE `orders` ADD `marginUsed` decimal(24,8);
--> statement-breakpoint
ALTER TABLE `orders` ADD `realizedPnl` decimal(24,8);
