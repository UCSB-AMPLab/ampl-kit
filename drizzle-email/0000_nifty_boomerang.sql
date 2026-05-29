CREATE TABLE `sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tool` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`resend_id` text,
	`idempotency_key` text,
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sends_idempotency_key_unique` ON `sends` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `sends_recipient_idx` ON `sends` (`recipient`);--> statement-breakpoint
CREATE INDEX `sends_tool_idx` ON `sends` (`tool`);--> statement-breakpoint
CREATE INDEX `sends_sent_at_idx` ON `sends` (`sent_at`);--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppressions_address_unique` ON `suppressions` (`address`);