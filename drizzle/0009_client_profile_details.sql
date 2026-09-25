ALTER TABLE `client_profiles` ADD `dateOfBirth` varchar(10);
--> statement-breakpoint
ALTER TABLE `client_profiles` ADD `address` varchar(255);
--> statement-breakpoint
ALTER TABLE `client_profiles` ADD `city` varchar(100);
--> statement-breakpoint
ALTER TABLE `client_profiles` ADD `occupation` varchar(120);
--> statement-breakpoint
ALTER TABLE `client_profiles` ADD `sourceOfFunds` enum('salary','business','investments','savings','inheritance','other');
