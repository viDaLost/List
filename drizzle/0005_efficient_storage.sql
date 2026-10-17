CREATE TABLE `object_transfers` (
	`object_key` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`verified_at` integer NOT NULL,
	`cleaned_at` integer
);
