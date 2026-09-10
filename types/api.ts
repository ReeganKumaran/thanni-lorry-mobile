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
  Incident,
  RouteStatus,
  SafetyState,
} from "@aura/types";

export type { BaseDomainEvent, Incident, RouteStatus, SafetyState };

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
  };
  status: JourneyStatus;
  safety_state: SafetyState;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type CreateJourneyBody = {
  destination_text: string;
  origin?: LocationPoint;
  user_id?: string;
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
};

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
