CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`article_id` text,
	`action` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`object_key` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `backups_article_idx` ON `backups` (`article_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text,
	`article_title` text NOT NULL,
	`article_slug` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);--> statement-breakpoint
CREATE INDEX `reports_article_idx` ON `reports` (`article_id`);--> statement-breakpoint
CREATE TABLE `request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`starts_at` integer NOT NULL,
	`hits` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `articles` ADD `moderation_blocked` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `moderation_reason` text DEFAULT '' NOT NULL;