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
};

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
