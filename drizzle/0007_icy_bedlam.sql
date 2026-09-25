CREATE TABLE `admin_approval_decisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`approverId` int NOT NULL,
	`decision` enum('approved','rejected') NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_approval_decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_approval_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actionType` varchar(80) NOT NULL,
	`targetType` varchar(80) NOT NULL,
	`targetId` varchar(80) NOT NULL,
	`payload` text NOT NULL,
	`status` enum('pending','approved','rejected','expired','executed') NOT NULL DEFAULT 'pending',
	`requestedBy` int NOT NULL,
	`reason` text NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_approval_requests_id` PRIMARY KEY(`id`)
);
