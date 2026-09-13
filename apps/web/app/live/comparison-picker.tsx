"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "live.compare";

export interface ComparableDevice {
  id: string;
  label: string;
  placement: "indoor" | "outdoor" | null;
  /** Current PM2.5, or null if this device doesn't report it. */
  pm25: number | null;
  /** False when offline or emitting a power-on frame — see tuya-public.ts. */
  trusted: boolean;
}

interface Selection {
  a: string | null;
  b: string | null;
}

function readStored(devices: ComparableDevice[]): Selection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Selection;
    // A device can be unpaired or renamed between visits; drop ids that are
    // no longer present rather than charting nothing.
    const exists = (id: string | null) =>
      id && devices.some((d) => d.id === id) ? id : null;
    return { a: exists(parsed.a), b: exists(parsed.b) };
  } catch {
    return null;
  }
}

function Select({
  label,
  value,
  devices,
  onChange,
}: {
  label: string;
  value: string | null;
  devices: ComparableDevice[];
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="flex flex-col text-xs text-neutral-400">
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
      >
        <option value="">— none —</option>
        {devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
            {d.placement ? ` (${d.placement})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ComparisonPicker({
  devices,
  defaults,
}: {
  devices: ComparableDevice[];
  defaults: Selection;
}) {
  // Initialised from the server-rendered defaults so the first paint matches
  // the HTML; the viewer's own choice is layered on after mount.
  const [selection, setSelection] = useState<Selection>(defaults);

  useEffect(() => {
    const stored = readStored(devices);
    if (stored && (stored.a || stored.b)) setSelection(stored);
  }, [devices]);

  const choose = (next: Selection) => {
    setSelection(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing or blocked storage: the picker still works for this
      // visit, it just won't be remembered.
    }
  };

  const find = (id: string | null) => devices.find((d) => d.id === id) ?? null;
  const a = find(selection.a);
  const b = find(selection.b);

  let body: React.ReactNode;

  if (!a || !b) {
    body = (
      <p className="text-sm text-neutral-500">
        Pick two sensors to compare.
      </p>
    );
  } else if (a.id === b.id) {
    body = (
      <p className="text-sm text-neutral-500">
        Those are the same sensor — pick two different ones.
      </p>
    );
  } else if (!a.trusted || !b.trusted) {
    // Never compute a headline number from a sensor we already know is
    // offline or mid-boot: a 0.0 reading would claim perfect filtration.
    const bad = [!a.trusted && a.label, !b.trusted && b.label]
      .filter(Boolean)
      .join(" and ");
    body = (
      <p className="text-sm text-amber-400/80">
        Waiting for a valid reading from {bad}.
      </p>
    );
  } else if (a.pm25 === null || b.pm25 === null) {
    body = (
      <p className="text-sm text-neutral-500">
        Both sensors need to report PM2.5 to compare them.
      </p>
    );
  } else if (b.pm25 <= 0) {
    body = (
      <p className="text-sm text-neutral-500">
        {b.label} reads 0 µg/m³, so there is no ratio to compute.
      </p>
    );
  } else {
    const reduction = ((b.pm25 - a.pm25) / b.pm25) * 100;
    body = (
      <p className="text-3xl font-semibold tabular-nums">
        {reduction > 0 ? "−" : "+"}
        {Math.abs(reduction).toFixed(1)}%
        <span className="ml-2 text-sm font-normal text-neutral-500">
          {a.label} vs {b.label}
        </span>
      </p>
    );
  }

  return (
    <>
      <div className="print-hide mb-3 flex flex-wrap items-end gap-3">
        <Select
          label="Compare"
          value={selection.a}
          devices={devices}
          onChange={(id) => choose({ a: id, b: selection.b })}
        />
        <Select
          label="Against"
          value={selection.b}
          devices={devices}
          onChange={(id) => choose({ a: selection.a, b: id })}
        />
      </div>
      {body}
    </>
  );
}
