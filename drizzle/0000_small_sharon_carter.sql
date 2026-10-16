CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`slug` text NOT NULL,
	`blocks` text NOT NULL,
	`cover` text DEFAULT '' NOT NULL,
	`theme` text DEFAULT 'paper' NOT NULL,
	`font` text DEFAULT 'serif' NOT NULL,
	`accent` text DEFAULT '#a34e32' NOT NULL,
	`alignment` text DEFAULT 'left' NOT NULL,
	`wide` integer DEFAULT 0 NOT NULL,
	`share_title` text DEFAULT '' NOT NULL,
	`share_description` text DEFAULT '' NOT NULL,
	`share_image` text DEFAULT '' NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `articles_owner_idx` ON `articles` (`owner_id`);--> statement-breakpoint
CREATE TABLE `paths` (
	`slug` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paths_article_idx` ON `paths` (`article_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `uploads_owner_idx` ON `uploads` (`owner_id`);