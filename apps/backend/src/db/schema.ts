import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  placement: text("placement", { enum: ["indoor", "outdoor"] }).notNull(),
  roomVolumeM3: real("room_volume_m3"),
});

export const deviceMetrics = sqliteTable(
  "device_metrics",
  {
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    dpCode: text("dp_code").notNull(),
    metric: text("metric").notNull(),
    unit: text("unit").notNull(),
    scale: integer("scale").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.dpCode] })],
);

export const readings = sqliteTable(
  "readings",
  {
    ts: integer("ts").notNull(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ts, t.deviceId, t.metric] }),
    index("readings_device_metric_ts_idx").on(t.deviceId, t.metric, t.ts),
  ],
);

export const calibration = sqliteTable(
  "calibration",
  {
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    metric: text("metric").notNull(),
    slope: real("slope").notNull(),
    intercept: real("intercept").notNull(),
    fittedAt: integer("fitted_at").notNull(),
    validFrom: integer("valid_from").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.metric, t.validFrom] }),
  ],
);

export const events = sqliteTable("events", {
  ts: integer("ts").notNull(),
  kind: text("kind").notNull(),
  note: text("note"),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  condition: text("condition", {
    enum: ["purifier_on", "purifier_off_control", "passive"],
  }).notNull(),
  fanSpeed: text("fan_speed"),
  notes: text("notes"),
});
