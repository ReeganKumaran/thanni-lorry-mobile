/**
 * Walking routes from OSRM, the OpenStreetMap router.
 *
 * A planned route is what makes "off route" mean anything: without one the
 * backend can only watch for long stops. OSRM needs no API key and works from
 * the same OSM data as the map tiles, so the line drawn matches the streets
 * underneath it.
 *
 * Two things about the public demo server, both measured rather than assumed:
 * it only hosts the car profile (a `/foot/` request came back at 7.95 m/s, which
 * is a car), and it snaps endpoints to the nearest routable road — a campus
 * address snapped 402 m away, ending the route nowhere near the destination.
 *
 * So the result is sanity-checked and rejected when it clearly does not describe
 * the journey asked for. A straight line between the real endpoints is a more
 * honest planned route than a driving detour that ends in the wrong street, and
 * deviation still works against it.
 *
 * The demo server is for development use, so this asks for one route per journey
 * and never polls.
 *   https://github.com/Project-OSRM/osrm-backend
 */

const OSRM = "https://router.project-osrm.org";
const USER_AGENT = "AURA-Safety-Companion/0.1 (accessibility journey monitor)";
const REQUEST_TIMEOUT_MS = 12_000;

/** [longitude, latitude], the order OSRM and GeoJSON both use. */
export type RoutePoint = [number, number];

export type PlannedRoute = {
  /** Street-following geometry, ready for the backend and the map. */
  coordinates: RoutePoint[];
  distanceMeters: number;
  durationSeconds: number;
};

type OsrmResponse = {
  code?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }[];
  /** How far each endpoint had to move to reach a routable road. */
  waypoints?: { distance?: number }[];
};

/** Past this, the route describes somewhere other than where you asked for. */
const MAX_SNAP_METERS = 150;

/** A detour this much longer than the direct line is not the journey you meant. */
const MAX_DETOUR_RATIO = 4;

const WALKING_SPEED_MPS = 1.3;

function straightLineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const metresPerDegree = 111_320;
  const dLat = (a.latitude - b.latitude) * metresPerDegree;
  const dLng =
    (a.longitude - b.longitude) *
    metresPerDegree *
    Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/** The honest fallback: a direct line between the two real points. */
export function directRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): PlannedRoute {
  const distanceMeters = Math.round(straightLineMeters(from, to));
  return {
    coordinates: [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    ],
    distanceMeters,
    durationSeconds: Math.round(distanceMeters / WALKING_SPEED_MPS),
  };
}

/**
 * Walking route between two points. Returns null rather than throwing: a
 * journey without a route is still monitored for inactivity, so a router
 * outage must not stop the traveller setting off.
 */
export async function fetchWalkingRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): Promise<PlannedRoute | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const path =
      `/route/v1/foot/${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
      `?overview=full&geometries=geojson`;

    const res = await fetch(`${OSRM}${path}`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;

    const body = (await res.json()) as OsrmResponse;
    if (body.code !== "Ok") return null;

    const route = body.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) return null;

    // Rejected rather than drawn: an endpoint dragged onto a distant road makes
    // the line describe a different journey.
    const worstSnap = Math.max(
      0,
      ...(body.waypoints ?? []).map((w) => w.distance ?? 0),
    );
    if (worstSnap > MAX_SNAP_METERS) return null;

    const direct = straightLineMeters(from, to);
    const distanceMeters = Math.round(route?.distance ?? 0);
    if (direct > 100 && distanceMeters > direct * MAX_DETOUR_RATIO) return null;

    // Stitch the real endpoints on, so the line starts where the traveller is
    // and ends where they are actually going, not where the road network is.
    return {
      coordinates: [
        [from.longitude, from.latitude],
        ...(coordinates as RoutePoint[]),
        [to.longitude, to.latitude],
      ],
      distanceMeters,
      durationSeconds: Math.round(route?.duration ?? 0),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
