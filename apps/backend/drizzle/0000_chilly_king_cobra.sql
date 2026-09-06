CREATE TABLE `calibration` (
	`device_id` text NOT NULL,
	`metric` text NOT NULL,
	`slope` real NOT NULL,
	`intercept` real NOT NULL,
	`fitted_at` integer NOT NULL,
	`valid_from` integer NOT NULL,
	PRIMARY KEY(`device_id`, `metric`, `valid_from`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `device_metrics` (
	`device_id` text NOT NULL,
	`dp_code` text NOT NULL,
	`metric` text NOT NULL,
	`unit` text NOT NULL,
	`scale` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`device_id`, `dp_code`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`placement` text NOT NULL,
	`room_volume_m3` real
);
--> statement-breakpoint
CREATE TABLE `events` (
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `readings` (
	`ts` integer NOT NULL,
	`device_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`ts`, `device_id`, `metric`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `readings_device_metric_ts_idx` ON `readings` (`device_id`,`metric`,`ts`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`condition` text NOT NULL,
	`fan_speed` text,
	`notes` text
);
