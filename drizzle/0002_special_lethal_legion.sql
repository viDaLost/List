CREATE TABLE `object_chunks` (
	`object_key` text NOT NULL,
	`part` integer NOT NULL,
	`data` text NOT NULL,
	`mime` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `object_chunks_key_idx` ON `object_chunks` (`object_key`,`part`);
--> statement-breakpoint
CREATE TRIGGER `object_chunks_quota` BEFORE INSERT ON `object_chunks` WHEN (SELECT COALESCE(SUM(length(data)), 0) FROM object_chunks) + length(NEW.data) > 268435456 BEGIN SELECT RAISE(ABORT, 'Object storage quota exceeded'); END;
