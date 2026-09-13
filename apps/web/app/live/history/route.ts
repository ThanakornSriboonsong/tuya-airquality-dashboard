import { NextResponse } from "next/server";
import { Metric } from "@tuya-dashboard/shared";
import {
  fetchLiveDevices,
  fetchRecentMetric,
  MAX_CHARTED_DEVICES,
} from "../../../lib/tuya-public";

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

    const series = await Promise.all(
      charted.map(async (device) => ({
        id: device.id,
        label: device.label,
        points: await fetchRecentMetric(device.id, metric),
      })),
    );

    return NextResponse.json({ metric, series });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}
