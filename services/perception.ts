/**
 * Camera frames to the edge node.
 *
 * AURA_TRD.md section 8: raw frames are not uploaded to the backend. They go to
 * the edge service on the local network, which runs YOLO and OCR and emits
 * structured events; only those events reach the API. The phone keeps no frames
 * and neither does the backend.
 *
 * The edge decides the sampling rate, not the phone. It answers every frame
 * with a cadence telling us when to send the next one — faster while walking or
 * during an alert, slower when stationary. No safety logic moves onto the
 * device (section 5.1); we send a picture and a speed reading, and are told
 * what was seen.
 */

import { getApiOrigin } from "./config";

/** The edge sits one port above the API, per the project's local topology. */
const EDGE_PORT_OFFSET = 1;

const REQUEST_TIMEOUT_MS = 12_000;

export type Hazard = {
  hazard_type: string;
  confidence: number;
  distance_estimate: string;
  lateral: string;
  severity: string;
  recommendation: string | null;
};

export type FrameResult = {
  accepted: boolean;
  throttled: boolean;
  duplicate: boolean;
  /** Nothing of note in view — worth knowing, not worth saying. */
  clear: boolean;
  /** One line of plain guidance, already written for a person to hear. */
  summary: string;
  hazards: Hazard[];
  objects: unknown[];
  texts: unknown[];
  cadence: {
    mode: string;
    target_fps: number;
    next_frame_after_ms: number;
    reason: string;
  } | null;
};

/**
 * Where the edge node is. Derived from the API origin so the two move together:
 * on this setup the phone reaches the API on 8000 and the edge on 8001, both
 * bridged to the laptop.
 */
export function getEdgeOrigin(): string {
  const origin = getApiOrigin();
  return origin.replace(/:(\d+)$/, (_, port) => `:${Number(port) + EDGE_PORT_OFFSET}`);
}

export async function isEdgeReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${getEdgeOrigin()}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export type SendFrameOptions = {
  journeyId: string;
  /** Local file URI from expo-camera. */
  uri: string;
  sequence: number;
  speedMps: number;
  safetyState: string;
  /** The traveller asked "what's in front of me?" — answer now, skip throttling. */
  scanNow?: boolean;
};

/**
 * Send one frame. Returns null rather than throwing: losing a frame is normal
 * on a walk, and a dropped frame must never interrupt the journey.
 */
export async function sendFrame(options: SendFrameOptions): Promise<FrameResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = new FormData();
    // React Native's FormData takes this shape for a local file.
    body.append("frame", {
      uri: options.uri,
      name: `frame-${options.sequence}.jpg`,
      type: "image/jpeg",
    } as unknown as Blob);
    body.append("journey_id", options.journeyId);
    body.append("sequence", String(options.sequence));
    body.append("speed_mps", String(options.speedMps));
    body.append("safety_state", options.safetyState);
    body.append("run_ocr", "true");
    if (options.scanNow) body.append("scan_now", "true");

    const res = await fetch(`${getEdgeOrigin()}/process-frame`, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as FrameResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
