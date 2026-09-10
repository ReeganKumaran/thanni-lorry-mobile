/**
 * OpenStreetMap geocoding via Nominatim.
 *
 * AURA is an accessibility product, so a map alone is not enough: searching by
 * name or address is the path that works without sight, and the chosen point is
 * always read back as an address rather than a pair of coordinates.
 *
 * Nominatim is a free community service with a usage policy we honour here:
 * an identifying User-Agent, at most one request a second, and searches issued
 * on submit rather than on every keystroke.
 *   https://operations.osmfoundation.org/policies/nominatim/
 */

const NOMINATIM = "https://nominatim.openstreetmap.org";

/** Nominatim requires callers to identify themselves. */
const USER_AGENT = "AURA-Safety-Companion/0.1 (accessibility journey monitor)";

const MIN_REQUEST_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 10_000;

let lastRequestAt = 0;

export type GeoResult = {
  /** Full address as OSM knows it. */
  label: string;
  /** Short leading part, useful as a heading. */
  name: string;
  latitude: number;
  longitude: number;
};

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

async function nominatim<T>(path: string): Promise<T> {
  await throttle();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${NOMINATIM}${path}`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`OpenStreetMap search failed (${res.status}).`);
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenStreetMap did not respond. Check your connection.");
    }
    throw error instanceof Error ? error : new Error("OpenStreetMap search failed.");
  } finally {
    clearTimeout(timer);
  }
}

type NominatimPlace = {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
};

function toResult(place: NominatimPlace): GeoResult | null {
  const latitude = Number.parseFloat(place.lat);
  const longitude = Number.parseFloat(place.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const label = place.display_name?.trim() || "Unnamed place";
  return {
    label,
    name: place.name?.trim() || label.split(",")[0].trim(),
    latitude,
    longitude,
  };
}

/** Search OpenStreetMap for a place or address. Call on submit, not per keystroke. */
export async function searchPlaces(query: string): Promise<GeoResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const places = await nominatim<NominatimPlace[]>(
    `/search?format=jsonv2&addressdetails=1&limit=8&q=${encodeURIComponent(trimmed)}`,
  );
  return places.map(toResult).filter((r): r is GeoResult => r !== null);
}

/** Describe a point on the map as an address, so a pin can be spoken aloud. */
export async function describeCoordinates(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const place = await nominatim<NominatimPlace>(
      `/reverse?format=jsonv2&zoom=18&lat=${latitude}&lon=${longitude}`,
    );
    return toResult(place)?.label ?? null;
  } catch {
    // A pin without an address is still a usable pin.
    return null;
  }
}
