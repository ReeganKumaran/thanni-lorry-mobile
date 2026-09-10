/**
 * Walking routes.
 *
 * A planned route is what makes "off route" mean anything: without one the
 * backend can only watch for long stops.
 *
 * Two routers, in order of how well they describe a walk:
 *
 * OpenRouteService has a real `foot-walking` profile — it routes along
 * footways and crossings rather than roads, which is the difference between a
 * usable line and a driving detour. It needs a free API key.
 *
 * OSRM's public demo server needs no key, and is the fallback when no key is
 * configured. Both of its problems were measured rather than assumed: it hosts
 * only the car profile (a `/foot/` request came back at 7.95 m/s, which is a
 * car), and it snaps endpoints to the nearest routable road — a campus address
 * snapped 402 m away, ending the route nowhere near the destination.
 *
 * Whatever answers, the result is sanity-checked and rejected when it plainly
 * does not describe the journey asked for. A straight line between the real
 * endpoints is a more honest planned route than a detour ending in the wrong
 * street, and deviation still works against it.
 *
 * One route per journey, never polled — both services are rate-limited and a
 * planned route does not change while you walk it.
 */

import Constants from "expo-constants";

const ORS = "https://api.openrouteservice.org";

/**
 * `foot-walking` follows footways and crossings. ORS also offers `wheelchair`,
 * which weights kerbs, inclines and surface — a different traveller, and worth
 * exposing as a preference rather than assuming.
 */
const ORS_PROFILE = "foot-walking";

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

/** Free tier, from EXPO_PUBLIC_ORS_API_KEY or expo config extra. */
function orsApiKey(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_ORS_API_KEY;
  const extra = Constants.expoConfig?.extra as { orsApiKey?: unknown } | undefined;
  const raw = typeof fromEnv === "string" && fromEnv.trim() ? fromEnv : extra?.orsApiKey;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** True when a real pedestrian profile is available rather than the car fallback. */
export function hasPedestrianRouting(): boolean {
  return orsApiKey() !== null;
}

type OrsResponse = {
  features?: {
    geometry?: { coordinates?: [number, number][] };
    properties?: { summary?: { distance?: number; duration?: number } };
  }[];
};

/** OpenRouteService, walking profile. Returns null so the caller can fall back. */
async function fetchFromOrs(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): Promise<PlannedRoute | null> {
  const key = orsApiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ORS}/v2/directions/${ORS_PROFILE}/geojson`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
        Accept: "application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
      }),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as OrsResponse;
    const feature = body.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) return null;

    const summary = feature?.properties?.summary;
    const distanceMeters = Math.round(summary?.distance ?? 0);

    // ORS routes door-to-door rather than snapping to a road, so the detour
    // guard is the only one that applies here.
    const direct = straightLineMeters(from, to);
    if (direct > 100 && distanceMeters > direct * MAX_DETOUR_RATIO) return null;

    return {
      coordinates: coordinates as RoutePoint[],
      distanceMeters,
      durationSeconds: Math.round(
        summary?.duration ?? distanceMeters / WALKING_SPEED_MPS,
      ),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walking route between two points. Returns null rather than throwing: a
 * journey without a route is still monitored for inactivity, so a router
 * outage must not stop the traveller setting off.
 */
async function fetchFromOsrm(
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

/**
 * Best available walking route between two points.
 *
 * Tries the pedestrian router first and falls back to the car-profile one, so
 * the app still plans a route before anyone has configured a key. Returns null
 * when neither describes the journey; the caller draws a direct line instead.
 */
export async function fetchWalkingRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): Promise<PlannedRoute | null> {
  return (await fetchFromOrs(from, to)) ?? (await fetchFromOsrm(from, to));
}
