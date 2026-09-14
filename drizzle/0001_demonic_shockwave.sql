ALTER TABLE `versions` ADD `files` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `trace` text DEFAULT '[]' NOT NULL;