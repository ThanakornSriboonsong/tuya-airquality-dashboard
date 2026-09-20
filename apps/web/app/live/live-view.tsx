"use client";

import { useEffect, useState } from "react";
import { Metric } from "@tuya-dashboard/shared";
import { aqiColor } from "../../lib/aqi-color";
import { METRIC_LABELS, METRIC_UNITS } from "../../lib/metric-labels";
import {
  aqiFor,
  formatValue,
  reductionPct,
  type MetricSummary,
} from "../../lib/report-stats";

const STORAGE_KEY = "live.placements";

export type Placement = "indoor" | "outdoor";

export interface ViewReading {
  metric: Metric;
  value: number;
  aqi: number | null;
}

export interface ViewDevice {
  id: string;
  label: string;
  placement: Placement | null;
  online: boolean;
  reporting: boolean;
  readings: ViewReading[];
  /** PM2.5 over the history window, from raw readings. Null when none exist. */
  summary: MetricSummary | null;
}

const METRIC_ORDER: Metric[] = [
  Metric.CO2,
  Metric.TEMPERATURE,
  Metric.HUMIDITY,
  Metric.VOC,
  Metric.CH2O,
];

function decimals(metric: Metric) {
  return metric === Metric.VOC || metric === Metric.CH2O ? 3 : 1;
}

type Overrides = Record<string, Placement | null>;

function readStored(): Overrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Overrides = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value === "indoor" || value === "outdoor" || value === null) {
        out[id] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function PlacementSelect({
  value,
  onChange,
}: {
  value: Placement | null;
  onChange: (next: Placement | null) => void;
}) {
  return (
    <>
      <select
        aria-label="Placement"
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as Placement | null)}
        className="print-hide rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
      >
        <option value="">— unset —</option>
        <option value="indoor">indoor</option>
        <option value="outdoor">outdoor</option>
      </select>
      {/* A dropdown is meaningless on paper; the PDF gets the plain label. */}
      {value && (
        <span className="hidden rounded-full border border-neutral-400 px-2 py-0.5 text-xs print:inline">
          {value}
        </span>
      )}
    </>
  );
}

function DeviceCard({
  device,
  onPlacementChange,
}: {
  device: ViewDevice;
  onPlacementChange: (next: Placement | null) => void;
}) {
  const trusted = device.online && device.reporting;
  const pm25 = device.readings.find((r) => r.metric === Metric.PM25);
  const others = METRIC_ORDER.map((m) =>
    device.readings.find((r) => r.metric === m),
  ).filter((r): r is ViewReading => r !== undefined);

  return (
    <div className="print-card print-break-inside-avoid rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-neutral-400">{device.label}</h2>
        <PlacementSelect value={device.placement} onChange={onPlacementChange} />
        {!trusted && (
          <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
            {device.online ? "No valid reading" : "Offline"}
          </span>
        )}
      </div>

      <div className={trusted ? undefined : "opacity-40"}>
        {pm25 ? (
          <div className="mb-4 flex items-baseline gap-3">
            <span className="text-4xl font-semibold">{pm25.value.toFixed(1)}</span>
            <span className="text-sm text-neutral-500">µg/m³ PM2.5</span>
            {pm25.aqi !== null && (
              <span
                className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: aqiColor(pm25.aqi) }}
              >
                AQI {pm25.aqi}
              </span>
            )}
          </div>
        ) : (
          <p className="mb-4 text-sm text-neutral-500">
            This device does not report PM2.5.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          {others.map((r) => (
            <div key={r.metric} className="flex justify-between">
              <dt className="text-neutral-500">{METRIC_LABELS[r.metric]}</dt>
              <dd>
                {r.value.toFixed(decimals(r.metric))} {METRIC_UNITS[r.metric]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {!trusted && (
        <p className="mt-4 border-t border-neutral-800 pt-3 text-xs text-amber-400/80">
          {device.online
            ? "This sensor is reporting its power-on frame (all zeros, CO₂ 511) rather than a measurement — it usually settles within a few minutes."
            : "This sensor is reporting as offline — the values above are its last known reading, not a current measurement."}
        </p>
      )}
    </div>
  );
}

function Comparison({ devices }: { devices: ViewDevice[] }) {
  // With more than one sensor at a placement, prefer one we can trust.
  const pick = (placement: Placement) =>
    devices.find((d) => d.placement === placement && d.online && d.reporting) ??
    devices.find((d) => d.placement === placement);

  const indoor = pick("indoor");
  const outdoor = pick("outdoor");

  if (!indoor || !outdoor) {
    const missing = [!indoor && "indoor", !outdoor && "outdoor"]
      .filter(Boolean)
      .join(" and ");
    return (
      <p className="text-sm text-neutral-500">
        Set one sensor to <strong>indoor</strong> and one to{" "}
        <strong>outdoor</strong> to compare them — no {missing} sensor is set.
      </p>
    );
  }

  // Never compute the headline from a sensor already known to be untrustworthy:
  // a 0.0 power-on reading would announce perfect filtration.
  const bad = [
    !(indoor.online && indoor.reporting) && indoor.label,
    !(outdoor.online && outdoor.reporting) && outdoor.label,
  ].filter(Boolean);
  if (bad.length > 0) {
    return (
      <p className="text-sm text-amber-400/80">
        Waiting for a valid reading from {bad.join(" and ")}.
      </p>
    );
  }

  const value = (d: ViewDevice) =>
    d.readings.find((r) => r.metric === Metric.PM25)?.value ?? null;
  const inside = value(indoor);
  const outside = value(outdoor);

  if (inside === null || outside === null) {
    return (
      <p className="text-sm text-neutral-500">
        Both sensors need to report PM2.5 to compare them.
      </p>
    );
  }
  if (outside <= 0) {
    return (
      <p className="text-sm text-neutral-500">
        The outdoor sensor reads 0 µg/m³, so there is no ratio to compute.
      </p>
    );
  }

  const reduction = ((outside - inside) / outside) * 100;

  return (
    <>
      <p className="text-3xl font-semibold tabular-nums">
        {reduction > 0 ? "−" : "+"}
        {Math.abs(reduction).toFixed(1)}%
        <span className="ml-2 text-sm font-normal text-neutral-500">
          {reduction > 0 ? "lower indoors" : "higher indoors"}
        </span>
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        {indoor.label} ({inside.toFixed(1)}) vs {outdoor.label} (
        {outside.toFixed(1)}) µg/m³
      </p>
    </>
  );
}

/**
 * The 24-hour report body, printed rather than shown.
 *
 * On screen the page is a live dashboard and the cards already carry current
 * values; on paper it needs to stand alone as a report of the window, so this
 * adds the period statistics and a reduction based on 24h means rather than one
 * instant. An instantaneous comparison is far noisier — a single spike on either
 * sensor swings it — so the printed figure is the one worth quoting.
 */
function PeriodReport({
  devices,
  windowHours,
}: {
  devices: ViewDevice[];
  windowHours: number;
}) {
  const summarised = devices.filter(
    (d): d is ViewDevice & { summary: MetricSummary } => d.summary !== null,
  );

  if (summarised.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No PM2.5 readings were recorded in the last {windowHours} hours, so there
        is nothing to report for this period.
      </p>
    );
  }

  const pick = (placement: Placement) =>
    summarised.find((d) => d.placement === placement && d.online && d.reporting) ??
    summarised.find((d) => d.placement === placement);

  const indoor = pick("indoor");
  const outdoor = pick("outdoor");
  const reduction =
    indoor && outdoor
      ? reductionPct(indoor.summary.mean, outdoor.summary.mean)
      : null;

  return (
    <>
      {reduction !== null && indoor && outdoor && (
        <p className="mb-4 text-sm">
          Averaged over the period, <strong>{indoor.label}</strong> ran{" "}
          <strong>
            {Math.abs(reduction).toFixed(1)}% {reduction > 0 ? "lower" : "higher"}
          </strong>{" "}
          than <strong>{outdoor.label}</strong> —{" "}
          {formatValue(Metric.PM25, indoor.summary.mean)} vs{" "}
          {formatValue(Metric.PM25, outdoor.summary.mean)} µg/m³ mean PM2.5.
        </p>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-1.5 font-medium">Sensor</th>
            <th className="py-1.5 text-right font-medium">Min</th>
            <th className="py-1.5 text-right font-medium">Mean</th>
            <th className="py-1.5 text-right font-medium">Max</th>
            <th className="py-1.5 text-right font-medium">Latest</th>
            <th className="py-1.5 text-right font-medium">AQI</th>
            <th className="py-1.5 text-right font-medium">n</th>
          </tr>
        </thead>
        <tbody>
          {summarised.map(({ id, label, placement, summary }) => (
            <tr key={id} className="border-b border-neutral-300 last:border-0">
              <td className="py-1.5">
                {label}
                {placement && (
                  <span className="text-neutral-500"> ({placement})</span>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatValue(Metric.PM25, summary.min)}
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums">
                {formatValue(Metric.PM25, summary.mean)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatValue(Metric.PM25, summary.max)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatValue(Metric.PM25, summary.current)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {aqiFor(Metric.PM25, summary.mean) ?? "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums text-neutral-500">
                {summary.n.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-neutral-500">
        PM2.5 in µg/m³ over the last {windowHours} hours. AQI is for the period
        mean. <em>n</em> is the number of readings each figure is based on.
      </p>
    </>
  );
}

export function LiveView({
  devices,
  windowHours,
}: {
  devices: ViewDevice[];
  windowHours: number;
}) {
  // Server values render first so the markup matches; a viewer's own choices
  // are layered on after mount.
  const [overrides, setOverrides] = useState<Overrides>({});
  useEffect(() => setOverrides(readStored()), []);

  const resolved = devices.map((d) => ({
    ...d,
    placement: d.id in overrides ? overrides[d.id] : d.placement,
  }));

  const setPlacement = (id: string, next: Placement | null) => {
    const updated = { ...overrides, [id]: next };
    setOverrides(updated);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Blocked storage: the choice still applies for this visit.
    }
  };

  const hasOverrides = Object.keys(overrides).length > 0;
  const reset = () => {
    setOverrides({});
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
  };

  const order = { indoor: 0, outdoor: 1 } as const;
  const sorted = [...resolved].sort(
    (a, b) =>
      (a.placement ? order[a.placement] : 2) -
      (b.placement ? order[b.placement] : 2),
  );

  return (
    <>
      <div className="print-card print-break-inside-avoid mb-8 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-neutral-400">
            Indoor vs outdoor — PM2.5
          </h2>
          {hasOverrides && (
            <button
              type="button"
              onClick={reset}
              className="print-hide text-xs text-neutral-500 underline hover:text-neutral-300"
            >
              Reset to site default
            </button>
          )}
        </div>
        <Comparison devices={sorted} />
      </div>

      {/* Print only: on screen this is a live dashboard, on paper a report of
          the period. Placement comes from the viewer's own choices above, so
          this has to live client-side with them. */}
      <section className="print-break-inside-avoid mb-8 hidden print:block">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Last {windowHours} hours — PM2.5
        </h2>
        <PeriodReport devices={sorted} windowHours={windowHours} />
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {sorted.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            onPlacementChange={(next) => setPlacement(device.id, next)}
          />
        ))}
      </div>
    </>
  );
}
