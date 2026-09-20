import { NextResponse } from "next/server";
import { Metric } from "@tuya-dashboard/shared";
import {
  fetchLiveDevices,
  fetchRecentMetric,
  HISTORY_ON_DEMAND_PAGE_BUDGET,
  MAX_CHARTED_DEVICES,
} from "../../../lib/tuya-public";
import { downsample } from "../../../lib/series";

// Matches the server-rendered chart: about a point a minute over the window.
const CHART_MAX_POINTS = 1440;

/**
 * History for one metric, for the public chart's metric picker.
 *
 * The page itself is statically rendered and cached, which is what keeps Tuya
 * usage flat under traffic. Reading the metric from a query string on the page
 * would make it dynamic and cost a Tuya call per visitor, so the switch is a
 * separate endpoint instead: the page stays cached, and only a viewer who
 * actually changes the metric triggers a fetch.
 *
 * Everything is cached server-side per device and metric for five minutes, so
 * repeated switching — by one viewer or a hundred — costs one round of calls.
 *
 * Lives under /live rather than /api because next.config rewrites /api/* to the
 * backend in rig mode; keeping it out of that namespace avoids depending on
 * route-versus-rewrite precedence.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("metric");

  const metric = (Object.values(Metric) as string[]).includes(requested ?? "")
    ? (requested as Metric)
    : null;

  if (!metric) {
    return NextResponse.json(
      { error: `Unknown metric: ${requested ?? "(none)"}` },
      { status: 400 },
    );
  }

  try {
    const devices = await fetchLiveDevices();
    const charted = devices
      .filter((d) => d.readings.some((r) => r.metric === metric))
      .slice(0, MAX_CHARTED_DEVICES);

    const histories = await Promise.all(
      charted.map((device) =>
        // A tighter budget than the page render: this request is interactive,
        // and CO₂ over 24h is ~60 pages per device.
        fetchRecentMetric(device.id, metric, HISTORY_ON_DEMAND_PAGE_BUDGET),
      ),
    );

    const series = charted.map((device, i) => ({
      id: device.id,
      label: device.label,
      points: downsample(histories[i].points, CHART_MAX_POINTS),
    }));

    const covered = histories
      .map((h) => h.coveredFrom)
      .filter((ts): ts is number => ts !== null);

    return NextResponse.json({
      metric,
      series,
      truncated: histories.some((h) => h.truncated),
      coveredHours:
        covered.length > 0 ? (Date.now() - Math.min(...covered)) / 3_600_000 : null,
    });
  } catch (error) {
    // Detail to the server log only: the message can name configuration
    // variables, and this response is rendered on a public page.
    console.error(`History request failed for metric ${metric}:`, error);
    return NextResponse.json(
      { error: "History is unavailable right now." },
      { status: 502 },
    );
  }
}
