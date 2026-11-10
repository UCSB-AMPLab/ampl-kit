-- Email sign-in links.
--
-- Rebuilds `users` so `github_id` can be NULL (accounts that sign in by email
-- link only) and adds a UNIQUE index on `email`; creates `email_login_tokens`.
-- Written by hand: SQLite cannot drop NOT NULL in place, and D1 runs a
-- migration as one transaction, where `PRAGMA foreign_keys=OFF` has no effect.
--
-- `sessions` is rebuilt too. Dropping `users` while `sessions` still refers to
-- it runs an implicit DELETE that counts as a foreign-key violation, and
-- deferring the check does not clear it: rows copied into `users_new` do not
-- count as parents of `sessions`, so the commit fails. Instead the sessions are
-- copied into `sessions_new`, whose foreign key points at `users_new`; both old
-- tables are dropped with no child rows left; and renaming `users_new` to
-- `users` rewrites the reference in `sessions_new`. Every session row keeps its
-- id, user id and timestamps, so existing cookies keep working.
--
-- Every `id` is copied as is, and the AUTOINCREMENT counter is carried over so
-- the id of a deleted user is never handed out again. Emails are stored
-- trimmed (spaces, tabs, line feeds, carriage returns) and lower-cased,
-- exactly as the app's normalizeEmail() does.
--
-- The guard table makes the migration fail, and the whole transaction roll
-- back, when two rows share an email after normalization. The error names the
-- constraint `users_email_duplicates_must_be_zero`.
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `_migration_0002_guard` (
	`duplicate_emails` integer NOT NULL CONSTRAINT `users_email_duplicates_must_be_zero` CHECK (`duplicate_emails` = 0)
);
--> statement-breakpoint
INSERT INTO `_migration_0002_guard` (`duplicate_emails`)
	SELECT COUNT(*) FROM (
		SELECT lower(trim(`email`, char(32) || char(9) || char(10) || char(13))) AS `e`
		FROM `users` GROUP BY `e` HAVING COUNT(*) > 1
	);
--> statement-breakpoint
DROP TABLE `_migration_0002_guard`;
--> statement-breakpoint
CREATE TABLE `users_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer,
	`email` text NOT NULL,
	`handle` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
INSERT INTO `users_new` (`id`, `github_id`, `email`, `handle`, `name`, `avatar_url`, `created_at`, `last_seen_at`)
	SELECT `id`, `github_id`, lower(trim(`email`, char(32) || char(9) || char(10) || char(13))), `handle`, `name`, `avatar_url`, `created_at`, `last_seen_at`
	FROM `users`;
--> statement-breakpoint
INSERT INTO `sqlite_sequence` (`name`, `seq`)
	SELECT 'users_new', `seq` FROM `sqlite_sequence`
	WHERE `name` = 'users'
		AND NOT EXISTS (SELECT 1 FROM `sqlite_sequence` WHERE `name` = 'users_new');
--> statement-breakpoint
UPDATE `sqlite_sequence`
	SET `seq` = (SELECT `seq` FROM `sqlite_sequence` WHERE `name` = 'users')
	WHERE `name` = 'users_new'
		AND `seq` < (SELECT `seq` FROM `sqlite_sequence` WHERE `name` = 'users');
--> statement-breakpoint
CREATE TABLE `sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users_new`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `sessions_new` (`id`, `user_id`, `created_at`, `expires_at`, `last_seen_at`)
	SELECT `id`, `user_id`, `created_at`, `expires_at`, `last_seen_at`
	FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `users_new` RENAME TO `users`;
--> statement-breakpoint
ALTER TABLE `sessions_new` RENAME TO `sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `email_login_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`limit_key` text NOT NULL,
	`return_to` text NOT NULL,
	`locale` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `email_login_tokens_email_created_idx` ON `email_login_tokens` (`email`, `created_at`);
--> statement-breakpoint
CREATE INDEX `email_login_tokens_limit_key_created_idx` ON `email_login_tokens` (`limit_key`, `created_at`);
