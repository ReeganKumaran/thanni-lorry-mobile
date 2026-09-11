/**
 * Wire shapes for the endpoints this app actually calls.
 *
 * The shared @aura/types package is the contract for enums and domain events,
 * so those are re-used directly. The response envelopes below mirror what
 * services/api returns today, which differs from @aura/types in a few small
 * ways (optional `name` on points, `created_at` on journeys).
 */

import type {
  BaseDomainEvent,
  GeocodeResult,
  Incident,
  Maneuver,
  NavigationInstruction,
  RouteStatus,
  SafetyState,
} from "@aura/types";

export type {
  BaseDomainEvent,
  Incident,
  Maneuver,
  NavigationInstruction,
  RouteStatus,
  SafetyState,
};

export type LocationPoint = {
  latitude: number;
  longitude: number;
  name?: string | null;
};

export type JourneyStatus =
  | "PENDING"
  | "STARTING"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED";

export type Journey = {
  id: string;
  user_id: string;
  destination: LocationPoint;
  origin: LocationPoint;
  route: {
    geometry: { type: string; coordinates: [number, number][] };
    eta_seconds: number;
    distance_meters: number;
    /** google | osm | synthetic | none — never present a synthetic line as surveyed. */
    provider: string;
  };
  status: JourneyStatus;
  safety_state: SafetyState;
  /** False when the backend could not turn the typed destination into a place. */
  destination_resolved: boolean;
  /** False when there is no route, so deviation is not being measured. */
  route_monitoring: boolean;
  /** Plain-language account of what was planned, safe to show or speak. */
  planning_note: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

/**
 * What the phone sends to open a journey.
 *
 * Deliberately no `route`: the backend geocodes the destination and plans the
 * polyline (`app/journey/planner.py`). The app used to do both, which put the
 * decision about what "off route" means on the client and required a routing
 * key inside the app bundle. Both are gone.
 */
export type CreateJourneyBody = {
  destination_text: string;
  origin?: LocationPoint;
  /** Identity for the trusted contact and operations consoles. Never safety
   *  input — the backend's verdict is identical without these. */
  device_id?: string;
  device_label?: string;
  traveller_name?: string;
};

/** Exactly the payload services/api expects on POST /locations. */
export type LocationUpdateBody = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed_mps: number;
  heading: number;
  client_timestamp: string;
};

export type LocationUpdateResult = {
  accepted: boolean;
  route_status: RouteStatus;
  deviation_meters: number;
  eta_delta_seconds: number;
  inactivity_seconds: number;
  safety_state: SafetyState;
  /** Label of the saved place the traveller is inside, if any. */
  at_place: string | null;
  /** True while inside a saved place — no safety checks are raised. */
  monitoring_paused: boolean;
  /** Distance still to walk along the planned route, computed by the backend. */
  remaining_meters: number;
  /** Route completed, already clamped to 0..1 by the backend. Never recompute it. */
  progress: number;
  /**
   * What to say next. Spoken only when `key` changes — the backend buckets it
   * so a 1 Hz GPS stream does not produce 1 Hz narration.
   */
  navigation: NavigationInstruction | null;
};

/**
 * A place the traveller searched for. Re-exported from the shared contract
 * rather than restated here, so it cannot drift from what the backend sends.
 */
export type { GeocodeResult };

/** Somewhere the traveller has told AURA that standing still is normal. */
export type KnownPlace = {
  id: string;
  user_id: string;
  label: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  created_at: string;
};

/** The labels offered as one-tap saves. */
export const PLACE_LABELS = ["Home", "Office", "College"] as const;
export type PlaceLabel = (typeof PLACE_LABELS)[number];

/**
 * How much ground a saved place covers.
 *
 * A flat and a university campus are both "somewhere I stop", but a radius that
 * suits one swallows the street outside the other. The hint says what each size
 * is actually for, since metres mean little until you see the circle.
 */
export const PLACE_SIZES = [
  { key: "small", label: "Small", meters: 200, hint: "A house or flat" },
  { key: "medium", label: "Medium", meters: 500, hint: "An office or building" },
  { key: "large", label: "Large", meters: 1500, hint: "A campus or neighbourhood" },
] as const;

export type PlaceSizeKey = (typeof PLACE_SIZES)[number]["key"];

export const DEFAULT_PLACE_SIZE: PlaceSizeKey = "small";

export function metersForSize(key: PlaceSizeKey): number {
  return PLACE_SIZES.find((s) => s.key === key)?.meters ?? 200;
}

/** Nearest size band to a radius already stored on the backend. */
export function sizeForMeters(meters: number): PlaceSizeKey {
  return PLACE_SIZES.reduce((best, size) =>
    Math.abs(size.meters - meters) < Math.abs(best.meters - meters) ? size : best,
  ).key;
}

export type SafetyStatus = {
  journey_id?: string;
  safety_state: SafetyState;
  risk_score: {
    total_score: number;
    explanation: string;
  } | null;
  active_incident: Incident | null;
  /** Navigation rides along on this poll, so a missed GPS response still speaks. */
  route_status?: RouteStatus | null;
  deviation_meters?: number;
  remaining_meters?: number;
  progress?: number;
  navigation?: NavigationInstruction | null;
};

/** Answers the backend accepts on POST /safety/checkin. */
export type CheckinResponse = "SAFE" | "HELP" | "INTENTIONAL_DETOUR";

export type CheckinResult = {
  accepted: boolean;
  new_safety_state: SafetyState;
};

/** The prompt the safety engine raised, read off the SAFETY_CHECK_SENT event. */
export type PendingSafetyCheck = {
  checkId: string;
  message: string;
  reason: string;
  timeoutSeconds: number;
  sentAt: string;
};
