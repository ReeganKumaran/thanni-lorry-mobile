/**
 * AURA — Shared TypeScript Interfaces & Data Contracts
 * Covers Domain Events, Entities, Safety States, Context Engine, and API Payloads.
 */

// =============================================================================
// 1. Core Enums & Status Constants
// =============================================================================

export type SafetyState =
  | 'SAFE'
  | 'UNUSUAL'
  | 'UNCERTAIN'
  | 'CHECKING'
  | 'RESOLVED'
  | 'HIGH_RISK'
  | 'ESCALATED';

export type JourneyStatus =
  | 'PENDING'
  | 'STARTING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

export type RouteStatus =
  | 'ON_ROUTE'
  | 'WATCH'
  | 'UNUSUAL'
  | 'SIGNIFICANT';

/** What the traveller should physically do next. */
export type Maneuver =
  | 'STRAIGHT'
  | 'LEFT'
  | 'RIGHT'
  | 'ARRIVE'
  | 'OFF_ROUTE';

export type IncidentStatus =
  | 'ACTIVE'
  | 'RESOLVED';

export type RiskLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export type EventSource =
  | 'mobile-gps'
  | 'edge-yolo'
  | 'edge-ocr'
  | 'journey-engine'
  | 'inactivity-engine'
  | 'safety-engine'
  | 'notification-engine'
  | 'agent'
  | 'simulator'
  | 'user'
  // An operator acting from the operations console (apps/ops). Distinct from
  // 'user': the traveller did not do this, someone acted on their behalf.
  | 'operator';

// =============================================================================
// 2. Domain Event Types & Payload Contracts (15 Events)
// =============================================================================

export type EventType =
  | 'LOCATION_UPDATED'
  | 'ROUTE_DEVIATED'
  | 'OBJECT_DETECTED'
  | 'TEXT_DETECTED'
  | 'OBSTACLE_DETECTED'
  | 'SCENE_CHANGED'
  | 'INACTIVITY_STARTED'
  | 'INACTIVITY_THRESHOLD'
  | 'SAFETY_CHECK_SENT'
  | 'USER_RESPONDED'
  | 'USER_NO_RESPONSE'
  | 'RISK_CHANGED'
  | 'ESCALATION_TRIGGERED'
  | 'INCIDENT_CREATED'
  | 'INCIDENT_RESOLVED'
  | 'INCIDENT_ACKNOWLEDGED'
  | 'ESCALATION_CALL_PLACED'
  | 'ESCALATION_CALL_FAILED';

export interface BaseDomainEvent<T = Record<string, unknown>> {
  id: string; // UUID
  journey_id: string; // UUID
  type: EventType;
  timestamp: string; // ISO-8601
  source: EventSource;
  confidence?: number;
  payload: T;
}

export interface LocationUpdatedPayload {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed_mps: number;
  heading: number;
  client_timestamp: string;
}

export interface RouteDeviatedPayload {
  deviation_meters: number;
  route_status: RouteStatus;
  threshold_meters: number;
  distance_from_origin_meters: number;
  eta_delta_seconds: number;
}

export interface ObjectDetectedPayload {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] or [x, y, w, h]
  is_hazard: boolean;
  distance_estimate?: 'immediate' | 'near' | 'far';
}

export interface TextDetectedPayload {
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
  category?: 'signage' | 'direction' | 'caution' | 'general';
}

export interface ObstacleDetectedPayload {
  hazard_type: string;
  distance_meters?: number;
  severity: 'low' | 'medium' | 'high';
  recommendation?: string;
}

export interface SceneChangedPayload {
  scene_type: 'indoor' | 'outdoor' | 'transit' | 'crowded' | 'unknown';
  description?: string;
}

export interface InactivityStartedPayload {
  started_at: string;
  last_speed_mps: number;
}

export interface InactivityThresholdPayload {
  inactivity_seconds: number;
  threshold_seconds: number;
  location: { latitude: number; longitude: number };
}

export interface SafetyCheckSentPayload {
  check_id: string;
  trigger_reason: string;
  prompt_message: string;
  timeout_seconds: number;
}

export interface UserRespondedPayload {
  check_id: string;
  response: 'SAFE' | 'HELP' | 'INTENTIONAL_DETOUR';
  channel: 'touch' | 'voice';
  raw_transcript?: string;
}

export interface UserNoResponsePayload {
  check_id: string;
  elapsed_seconds: number;
  timeout_seconds: number;
}

export interface RiskChangedPayload {
  previous_state: SafetyState;
  new_state: SafetyState;
  risk_score: number;
  primary_factor: string;
}

export interface EscalationTriggeredPayload {
  reason: string;
  risk_score: number;
  evidence: {
    deviation_meters?: number;
    inactivity_seconds?: number;
    eta_delta_seconds?: number;
    checkin_status?: string;
    environment_signals?: string[];
  };
}

export interface IncidentCreatedPayload {
  incident_id: string;
  risk_level: RiskLevel;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface IncidentResolvedPayload {
  incident_id: string;
  resolved_by: string;
  resolution_note?: string;
}

/** Where an escalation call is routed. An agent may classify this; the
 *  deterministic engine decides whether any call happens at all. */
export type EscalationRoute =
  | 'TRUSTED_CONTACT'
  | 'MEDICAL'
  | 'POLICE';

/** Evidence carried on every escalation call: where they are, and why. */
export interface EscalationCallEvidence {
  reason: string;
  risk_level: RiskLevel;
  safety_state: SafetyState;
  latitude: number | null;
  longitude: number | null;
  map_url: string | null;
  destination: string | null;
  deviation_meters: number | null;
  inactivity_seconds: number | null;
  history_points: number;
  signals: Record<string, unknown>;
  /** Present when a MEDICAL/POLICE route was downgraded to the trusted
   *  contact because emergency dialling is disabled. Show this. */
  route_downgrade?: string;
}

export interface EscalationCallPlacedPayload {
  incident_id: string;
  route: EscalationRoute;
  provider: string;
  to_name: string;
  /** Redacted, e.g. "+44…8891". The full number never leaves the backend. */
  to_number_redacted: string | null;
  call_id: string | null;
  /** True when the call went to the dry-run sink rather than a telephone.
   *  The console must say so — nobody has actually been reached. */
  dry_run: boolean;
  attempts: number;
  reason: string;
  evidence: EscalationCallEvidence;
}

/** Nobody was reached. This is the most serious event AURA emits: it needs a
 *  human to act. `suppressed` means AURA deliberately did not dial (no number
 *  configured, or emergency dialling disabled) rather than tried and failed. */
export interface EscalationCallFailedPayload {
  incident_id: string;
  route: EscalationRoute;
  provider: string;
  to_name: string | null;
  to_number_redacted: string | null;
  error: string;
  status_code: number | null;
  attempts: number;
  dry_run: boolean;
  suppressed: boolean;
  reason: string;
  evidence: EscalationCallEvidence;
}

// Map event types to their specific payload
export type DomainEventMap = {
  LOCATION_UPDATED: BaseDomainEvent<LocationUpdatedPayload>;
  ROUTE_DEVIATED: BaseDomainEvent<RouteDeviatedPayload>;
  OBJECT_DETECTED: BaseDomainEvent<ObjectDetectedPayload>;
  TEXT_DETECTED: BaseDomainEvent<TextDetectedPayload>;
  OBSTACLE_DETECTED: BaseDomainEvent<ObstacleDetectedPayload>;
  SCENE_CHANGED: BaseDomainEvent<SceneChangedPayload>;
  INACTIVITY_STARTED: BaseDomainEvent<InactivityStartedPayload>;
  INACTIVITY_THRESHOLD: BaseDomainEvent<InactivityThresholdPayload>;
  SAFETY_CHECK_SENT: BaseDomainEvent<SafetyCheckSentPayload>;
  USER_RESPONDED: BaseDomainEvent<UserRespondedPayload>;
  USER_NO_RESPONSE: BaseDomainEvent<UserNoResponsePayload>;
  RISK_CHANGED: BaseDomainEvent<RiskChangedPayload>;
  ESCALATION_TRIGGERED: BaseDomainEvent<EscalationTriggeredPayload>;
  INCIDENT_CREATED: BaseDomainEvent<IncidentCreatedPayload>;
  INCIDENT_RESOLVED: BaseDomainEvent<IncidentResolvedPayload>;
  ESCALATION_CALL_PLACED: BaseDomainEvent<EscalationCallPlacedPayload>;
  ESCALATION_CALL_FAILED: BaseDomainEvent<EscalationCallFailedPayload>;
};

// =============================================================================
// 3. Database Entity Models (Supabase 8 Tables)
// =============================================================================

export interface User {
  id: string; // UUID
  name: string;
  phone: string;
  preferences: {
    voice_guidance_enabled: boolean;
    high_contrast: boolean;
    speech_rate: number;
    auto_escalate_timeout_seconds: number;
  };
  created_at: string;
}

export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][]; // [longitude, latitude]
}

export interface Journey {
  id: string;
  user_id: string;
  origin: {
    name: string;
    latitude: number;
    longitude: number;
  };
  destination: {
    name: string;
    latitude: number;
    longitude: number;
  };
  route_geometry: RouteGeometry;
  expected_eta: string; // ISO-8601
  expected_duration_seconds: number;
  status: JourneyStatus;
  safety_state: SafetyState;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface RoutePoint {
  id: string;
  journey_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading: number;
  timestamp: string;
}

export interface JourneyEventRecord {
  id: string;
  journey_id: string;
  type: EventType;
  timestamp: string;
  payload: Record<string, unknown>;
  severity: 'info' | 'warning' | 'critical';
  source: string;
}

export interface EnvironmentEventRecord {
  id: string;
  journey_id: string;
  type: 'OBJECT_DETECTED' | 'TEXT_DETECTED' | 'OBSTACLE_DETECTED' | 'SCENE_CHANGED';
  timestamp: string;
  payload: Record<string, unknown>;
  confidence: number | null;
  source: string;
}

export interface SafetyCheck {
  id: string;
  journey_id: string;
  trigger: string;
  message: string;
  sent_at: string;
  response: 'SAFE' | 'HELP' | 'NO_RESPONSE' | null;
  responded_at: string | null;
}

export interface Incident {
  id: string;
  journey_id: string;
  risk_level: RiskLevel;
  reason: string;
  evidence: {
    deviation_meters?: number;
    inactivity_seconds?: number;
    eta_delta_seconds?: number;
    checkin_status?: string;
    environment_cues?: string[];
    summary?: string;
  };
  status: IncidentStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by?: string | null;
  /** An operator has taken ownership. The incident is still ACTIVE. */
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
}

export interface TrustedContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  notification_preferences: {
    sms_enabled: boolean;
    push_enabled: boolean;
    call_on_critical: boolean;
  };
}

// =============================================================================
// 4. Digital Twin & Context Engine Models
// =============================================================================

export interface ExpectedJourneyState {
  destination_name: string;
  destination_coords: [number, number]; // [lat, lng]
  total_distance_meters: number;
  expected_eta_timestamp: string;
  expected_speed_range_mps: [number, number];
}

export interface ActualJourneyState {
  current_location: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  distance_from_route_meters: number;
  current_speed_mps: number;
  inactivity_seconds: number;
  actual_eta_timestamp: string;
  eta_delta_seconds: number;
  recent_environment: {
    detected_objects: string[];
    detected_texts: string[];
  };
}

export interface JourneyDigitalTwin {
  expected: ExpectedJourneyState;
  actual: ActualJourneyState;
  is_deviated: boolean;
  is_inactive: boolean;
}

export interface RiskContext {
  safety_state: SafetyState;
  risk_score: number; // 0.0 to 1.0
  deviation_score: number;
  inactivity_score: number;
  eta_delta_score: number;
  no_response_score: number;
  explicit_help_score: number;
  environment_score: number;
  explanation: string;
}

export interface AuraContext {
  journey_id: string;
  user_id: string;
  digital_twin: JourneyDigitalTwin;
  risk: RiskContext;
  last_checkin?: SafetyCheck | null;
  active_incident?: Incident | null;
  recent_events: BaseDomainEvent[];
}

// =============================================================================
// 5. API Contracts (Request & Response)
// =============================================================================

export interface CreateJourneyRequest {
  destination_text: string;
  origin?: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  /** Identity for the trusted-contact and operations consoles.
   *  Never safety input: the backend's verdict is identical without it. */
  device_id?: string;
  device_label?: string;
  traveller_name?: string;
}

/**
 * The next spoken instruction, computed by services/api.
 *
 * `key` is stable across GPS fixes for the same instruction and bucketed by
 * distance, so a client speaks only when it changes. Announcing on every fix at
 * 1 Hz is worse than silence, and for a traveller relying on audio alone it is
 * actively harmful (AURA_DESIGN.md section 32).
 */
export interface NavigationInstruction {
  text: string;
  maneuver: Maneuver;
  distance_m: number;
  key: string;
}

export interface JourneyResponse {
  id: string;
  user_id: string;
  destination: {
    name: string;
    latitude: number;
    longitude: number;
  };
  origin: {
    name: string;
    latitude: number;
    longitude: number;
  };
  route: {
    geometry: RouteGeometry;
    eta_seconds: number;
    distance_meters: number;
    /** google | osm | synthetic | none. A synthetic line is never shown as surveyed. */
    provider: string;
  };
  status: JourneyStatus;
  safety_state: SafetyState;
  /** False when the destination text could not be turned into a real place. */
  destination_resolved: boolean;
  /** False when there is no route, so deviation is not being measured. */
  route_monitoring: boolean;
  /** Plain-language account of what was planned, for the client to show. */
  planning_note: string | null;
  started_at: string | null;
}

/**
 * A place resolved by `GET /places/search` or `GET /places/describe`.
 *
 * `name` is short and speakable — it is read aloud; `address` is the full
 * formatted address, which is what confirms to a screen-reader user that the
 * right place was picked. `approximate` marks a point that was invented rather
 * than looked up, and must be surfaced rather than quietly presented as a fact.
 */
export interface GeocodeResult {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  approximate: boolean;
}

export interface LocationUpdateRequest {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed_mps: number;
  heading: number;
  client_timestamp: string;
}

export interface LocationUpdateResponse {
  accepted: boolean;
  route_status: RouteStatus;
  deviation_meters: number;
  eta_delta_seconds: number;
  inactivity_seconds: number;
  safety_state: SafetyState;
  /** Label of the saved place the traveller is inside, if any. */
  at_place?: string | null;
  /** True while inside a saved place — no safety checks are raised. */
  monitoring_paused?: boolean;
  /** Distance still to walk along the planned route. */
  remaining_meters: number;
  /**
   * Fraction of the route behind the traveller, already clamped to 0..1 by the
   * server. Clients must not recompute this: an off-route traveller projects
   * onto whichever segment is nearest, which makes an unclamped figure jump.
   */
  progress: number;
  /** What to say next, or null when there is nothing worth saying. */
  navigation: NavigationInstruction | null;
}

export interface SafetyCheckResponseRequest {
  response: 'SAFE' | 'HELP' | 'INTENTIONAL_DETOUR';
  transcript?: string;
}

export interface ResolveIncidentRequest {
  resolution_note?: string;
}

export type SimulationScenarioName =
  | 'normal'
  | 'intentional_detour'
  | 'accidental_deviation'
  | 'no_response'
  | 'explicit_help';

export interface StartSimulationRequest {
  scenario: SimulationScenarioName;
  speed_multiplier?: number;
}
