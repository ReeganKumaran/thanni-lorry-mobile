/**
 * Client for the edge CV node (`thanni-lorry-backend/services/edge`).
 *
 * The phone is a camera and a speaker here, nothing more. It uploads a frame
 * and reads back three things: what the node saw, the sentence the node wants
 * said about it, and when to send the next frame. It does not classify, score
 * or decide (AURA_TRD.md section 5.1) — the node runs the models and the
 * backend fuses the result.
 *
 * Raw video never leaves the edge node: frames go laptop-side, are turned into
 * structured domain events there, and only those events are forwarded to the
 * API (PRD section 13). Nothing here uploads a frame to `services/api`.
 */

import { getEdgeOrigin } from "./config";

/**
 * Longer than the API client's 8s: a frame carries a JPEG body and the node may
 * be running two detectors on one core. Still bounded, because a stalled upload
 * must not wedge the capture loop.
 */
const FRAME_TIMEOUT_MS = 15_000;

/** Matches `CadenceOut` in services/edge/schemas.py. */
export type EdgeCadence = {
  mode: string;
  target_fps: number;
  next_frame_after_ms: number;
  reason: string;
};

/**
 * Matches `HazardOut`. `recommendation` is the spoken sentence the node built
 * from its own taxonomy — see services/edge/hazards.py. The phone speaks it
 * verbatim rather than composing its own copy, which is what keeps the words
 * honest: the node maps RDD2022's D00/D10/D20 to `road_crack` and phrases it
 * "broken, uneven pavement", never "pothole". Writing that sentence here would
 * be a second place for it to drift out of step with what the model detects.
 */
export type EdgeHazard = {
  hazard_type: string;
  raw_label?: string | null;
  confidence: number;
  bbox: number[];
  distance_estimate: "immediate" | "near" | "far";
  lateral: "left" | "ahead" | "right";
  severity: "low" | "medium" | "high";
  recommendation?: string | null;
};

export type EdgeDetection = {
  label: string;
  confidence: number;
  bbox: number[];
  is_hazard: boolean;
  distance_estimate: "immediate" | "near" | "far";
};

export type EdgeForwardResult = {
  attempted: boolean;
  delivered: boolean;
  status_code?: number | null;
  error?: string | null;
};

/** The subset of `ProcessFrameResponse` the app actually reads. */
export type ProcessFrameResult = {
  /** False when the node declined to run models on this frame. */
  accepted: boolean;
  /** Rate-limited: the frame was NOT looked at. Not the same as "nothing found". */
  throttled: boolean;
  /** Perceptually identical to a recent frame, so no model ran. */
  duplicate: boolean;
  sequence?: number | null;
  processing_ms: number;
  cadence?: EdgeCadence | null;
  hazards: EdgeHazard[];
  objects: EdgeDetection[];
  forwarded?: EdgeForwardResult | null;
};

/**
 * What actually happened to a frame, in the three ways that matter to someone
 * who cannot see the screen.
 *
 * "I looked and found nothing" and "I never looked" are completely different
 * answers, and collapsing them into silence is why hazard detection felt dead:
 * a stationary traveller is sampled once every five seconds and de-duplicated
 * after that, so aiming at a hazard produced nothing at all.
 */
export type FrameOutcome = "hazard" | "clear" | "unchanged" | "not-sampled";

export function outcomeOf(result: ProcessFrameResult): FrameOutcome {
  if (result.hazards && result.hazards.length > 0) return "hazard";
  if (result.throttled || !result.accepted) return "not-sampled";
  if (result.duplicate) return "unchanged";
  return "clear";
}

export class EdgeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EdgeError";
    this.status = status;
  }
}

/**
 * Session key for a deliberate, user-requested scan.
 *
 * The node keys its rate limiter and its perceptual de-duplicator on this, so a
 * scan under its own key is never swallowed as "too soon" or "same as the last
 * one" by the passive stream — which at 0.2 FPS while standing still is exactly
 * what was happening. Someone who stops and aims the phone is asking a
 * question, and a question deserves an answer rather than a dropped frame.
 *
 * When the edge exposes an explicit scan-now bypass this becomes that flag
 * instead; the client change is this one function.
 */
export function scanSessionKey(journeyId: string): string {
  return `${journeyId}:scan`;
}

export type FrameUpload = {
  /** `file://` URI from CameraView.takePictureAsync. */
  uri: string;
  journeyId: string;
  /** Raw GPS speed. An input to the node's cadence decision only. */
  speedMps: number;
  /** The state the backend last told us — echoed back, never decided here. */
  safetyState: string;
  sequence: number;
  width?: number | null;
  height?: number | null;
  /** Overrides the node's per-journey session. See scanSessionKey. */
  sessionKey?: string;
};

/**
 * Upload one frame for inference.
 *
 * `run_ocr` is left at the node's default: sign reading is part of what the
 * traveller needs and the node already rate-limits it.
 */
export async function processFrame(frame: FrameUpload): Promise<ProcessFrameResult> {
  const body = new FormData();
  // React Native's FormData takes this shape for a file part; the cast is the
  // usual one, as the DOM lib types the value as Blob | string.
  body.append("frame", {
    uri: frame.uri,
    name: `frame-${frame.sequence}.jpg`,
    type: "image/jpeg",
  } as unknown as Blob);
  body.append("journey_id", frame.journeyId);
  body.append("sequence", String(frame.sequence));
  body.append("speed_mps", String(frame.speedMps));
  body.append("safety_state", frame.safetyState);
  if (frame.width) body.append("width", String(frame.width));
  if (frame.height) body.append("height", String(frame.height));
  if (frame.sessionKey) body.append("session_key", frame.sessionKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FRAME_TIMEOUT_MS);

  try {
    const res = await fetch(`${getEdgeOrigin()}/process-frame`, {
      method: "POST",
      body,
      signal: controller.signal,
      // Content-Type is deliberately unset: RN fills in the multipart boundary.
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new EdgeError(await describeFailure(res), res.status);
    }
    return (await res.json()) as ProcessFrameResult;
  } catch (error) {
    if (error instanceof EdgeError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new EdgeError("The edge node did not respond in time.", 0);
    }
    throw new EdgeError(`Can't reach the edge node at ${getEdgeOrigin()}.`, 0);
  } finally {
    clearTimeout(timer);
  }
}

async function describeFailure(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Non-JSON error body.
  }
  return `Edge node returned ${res.status}.`;
}

/** True when an edge node is answering. Used to decide whether to open the camera at all. */
export async function checkEdgeHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${getEdgeOrigin()}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
