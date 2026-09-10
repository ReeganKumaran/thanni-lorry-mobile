/**
 * The camera half of the perception pipeline.
 *
 * Captures a frame, sends it to the edge CV node, speaks whatever the node says
 * is on the ground ahead, and waits as long as the node asks before doing it
 * again. The chain is:
 *
 *   camera -> POST /process-frame (edge) -> POST /api/v1/perception/events
 *          -> SSE /api/v1/events -> trusted-contact console
 *
 * The phone holds no safety logic (AURA_TRD.md section 5.1). It does not decide
 * what a hazard is, how dangerous it is, or which one matters most: the node
 * classifies, scores severity, orders worst-first and writes the sentence. This
 * hook decides one thing only — whether it has already said this.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import type { CameraView } from "expo-camera";

import { EdgeError, processFrame } from "../services/perception";
import type { EdgeHazard } from "../services/perception";
import { speak } from "../services/speech";

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------
// The node owns the real decision and returns `cadence.next_frame_after_ms` on
// every frame (services/edge/schemas.py, CadenceOut). These constants are only
// what the phone uses before the first reply and while the node is unreachable,
// and they are deliberately the same numbers as the node's defaults in
// services/edge/config.py so the two can never disagree about a fresh journey.

/** Nothing changes in front of you while you are standing still. */
const FALLBACK_STATIONARY_FPS = 0.2;
/** Walking pace: about one frame per step-and-a-half. */
const FALLBACK_WALKING_FPS = 1.0;
/** Brief burst while the journey is not SAFE, or just after a hazard. */
const FALLBACK_ALERT_FPS = 2.5;

/** Below this the traveller counts as stationary. Matches STATIONARY_SPEED_MPS. */
const STATIONARY_SPEED_MPS = 0.2;

/** How long a hazard keeps the fast window open. Matches ALERT_BURST_SECONDS. */
const ALERT_BURST_MS = 10_000;

/** Never faster than the node's MAX_FPS of 3, and never slower than this. */
const MIN_FRAME_INTERVAL_MS = 333;
const MAX_FRAME_INTERVAL_MS = 15_000;

/** After a failed upload, back off rather than hammering an absent node. */
const EDGE_BACKOFF_MS = 5_000;

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * The node letterboxes to 640px internally whatever it is handed
 * (services/edge/HAZARD_MODEL.md), so anything larger is bytes over the wire
 * and battery for nothing. Picked from the camera's own list, so the downscale
 * happens in the capture pipeline instead of afterwards in JS.
 */
const TARGET_CAPTURE_EDGE_PX = 640;
const JPEG_QUALITY = 0.5;

/**
 * How long before the same hazard may be spoken again.
 *
 * AURA_DESIGN.md section 32 is explicit that the traveller must not be narrated
 * at. A crack in the pavement stays in frame for many seconds and the node
 * re-reports it on every frame; announcing a *new* hazard is useful, repeating
 * it is noise. speech.ts suppresses an identical line for 20s on its own — this
 * is the longer, hazard-shaped window on top, keyed on what and where rather
 * than on the exact wording.
 */
const HAZARD_REANNOUNCE_MS = 45_000;

export type PerceptionPhase =
  | "idle"
  | "no-permission"
  | "waiting-for-camera"
  | "running"
  | "edge-unreachable";

export type CameraPerception = {
  /** Attach to the CameraView. */
  cameraRef: React.RefObject<CameraView>;
  /** True while the CameraView should be mounted and powered. */
  active: boolean;
  phase: PerceptionPhase;
  /** Call from CameraView's onCameraReady. */
  onCameraReady: () => void;
  /** Chosen from getAvailablePictureSizesAsync; undefined until known. */
  pictureSize: string | undefined;
  /** Last sentence spoken about the ground ahead, for the on-screen line. */
  lastHazardSpoken: string | null;
  framesSent: number;
  /** What cadence the node last asked for, in its words. */
  cadenceMode: string | null;
  cadenceFps: number | null;
  error: string | null;
};

type Options = {
  /** Null when no journey is running: the camera stays closed. */
  journeyId: string | null;
  /** Raw GPS speed from the journey monitor. Reported, never interpreted. */
  speedMps: number;
  /** The state the backend last sent us. Echoed to the node, never decided here. */
  safetyState: string;
  /** False turns capture off without unmounting the journey screen. */
  enabled: boolean;
};

function fpsToInterval(fps: number): number {
  return clampInterval(Math.round(1000 / fps));
}

function clampInterval(ms: number): number {
  return Math.min(MAX_FRAME_INTERVAL_MS, Math.max(MIN_FRAME_INTERVAL_MS, ms));
}

/**
 * What to do until the node tells us otherwise.
 *
 * Not a safety judgement: "am I moving" is a sensor reading and "is the backend
 * state SAFE" is a value the backend handed us. Neither is decided here.
 */
function fallbackInterval(
  speedMps: number,
  safetyState: string,
  lastHazardAt: number | null,
): number {
  const inAlertBurst = lastHazardAt !== null && Date.now() - lastHazardAt < ALERT_BURST_MS;
  if (safetyState !== "SAFE" || inAlertBurst) return fpsToInterval(FALLBACK_ALERT_FPS);
  if (speedMps < STATIONARY_SPEED_MPS) return fpsToInterval(FALLBACK_STATIONARY_FPS);
  return fpsToInterval(FALLBACK_WALKING_FPS);
}

/**
 * What makes two sightings "the same hazard" for the purpose of not repeating
 * ourselves. Type alone is too coarse — a crack that was further ahead and is
 * now right in front of you is worth saying again.
 */
function hazardKey(hazard: EdgeHazard): string {
  return `${hazard.hazard_type}|${hazard.distance_estimate}|${hazard.lateral}`;
}

/** Pick the closest available capture size at or above the node's working width. */
function chooseSmallestSize(sizes: string[]): string | undefined {
  const parsed = sizes
    .map((size) => {
      const [w, h] = size.split("x").map((n) => Number.parseInt(n, 10));
      return Number.isFinite(w) && Number.isFinite(h)
        ? { size, longest: Math.max(w, h) }
        : null;
    })
    .filter((entry): entry is { size: string; longest: number } => entry !== null)
    .sort((a, b) => a.longest - b.longest);

  if (parsed.length === 0) return undefined;
  return (
    parsed.find((entry) => entry.longest >= TARGET_CAPTURE_EDGE_PX)?.size ??
    parsed[parsed.length - 1].size
  );
}

export function useCameraPerception({
  journeyId,
  speedMps,
  safetyState,
  enabled,
}: Options): CameraPerception {
  const cameraRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<PerceptionPhase>("idle");
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [lastHazardSpoken, setLastHazardSpoken] = useState<string | null>(null);
  const [framesSent, setFramesSent] = useState(0);
  const [cadenceMode, setCadenceMode] = useState<string | null>(null);
  const [cadenceFps, setCadenceFps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [foreground, setForeground] = useState(
    () => AppState.currentState === "active",
  );

  // Read inside the capture loop, so a 1 Hz GPS tick does not tear the loop
  // down and build it again.
  const speedRef = useRef(speedMps);
  const safetyStateRef = useRef(safetyState);
  const sequenceRef = useRef(0);
  const lastHazardAtRef = useRef<number | null>(null);
  const announcedRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  speedRef.current = speedMps;
  safetyStateRef.current = safetyState;

  // The camera is a power draw and a privacy surface: it must not keep running
  // behind another app. Expo also tears the preview down on background, so a
  // capture attempted there fails anyway.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => setForeground(next === "active");
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

  const onCameraReady = useCallback(() => {
    setCameraReady(true);
    void (async () => {
      try {
        const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
        if (sizes && sizes.length > 0) setPictureSize(chooseSmallestSize(sizes));
      } catch {
        // Not fatal: capture just runs at the camera's default size.
      }
    })();
  }, []);

  const announce = useCallback((hazards: EdgeHazard[], safetyState: string) => {
    // Worst first, decided by the node (services/edge/pipeline.py sorts on
    // severity, then proximity, then confidence). Taking the head means the
    // phone never ranks hazards itself, and says one thing rather than reading
    // out a list.
    const worst = hazards[0];
    if (!worst) return;

    lastHazardAtRef.current = Date.now();

    // Only while the journey is calm. Once the FSM has left SAFE the traveller
    // is in a conversation about their own safety — being asked "Are you
    // safe?", or having just been told their contact is on the way and to stay
    // put. Pavement is not what they need in that moment, and AURA_DESIGN.md
    // section 32 is explicit that narration must not intrude on a safety
    // event. Frames keep flowing, so the console and the backend still get the
    // evidence; only the talking stops.
    if (safetyState !== "SAFE") return;

    const sentence = worst.recommendation?.trim();
    // No sentence from the node means nothing safe to say. Silence beats
    // inventing wording for a detection we did not classify.
    if (!sentence) return;

    const key = hazardKey(worst);
    const now = Date.now();
    const spokenAt = announcedRef.current.get(key);
    if (spokenAt !== undefined && now - spokenAt < HAZARD_REANNOUNCE_MS) return;

    announcedRef.current.set(key, now);
    speak(sentence, "hazard");
    // The app's own text-to-speech is a separate pipeline from the screen
    // reader: it can be muted on its own, and it is no use at all to someone
    // reading a braille display. Announce through both.
    AccessibilityInfo.announceForAccessibility(sentence);
    setLastHazardSpoken(sentence);
  }, []);

  const shouldRun = Boolean(journeyId) && enabled && cameraReady && foreground;

  useEffect(() => {
    if (!shouldRun || !journeyId) {
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setPhase(journeyId ? "waiting-for-camera" : "idle");
      return;
    }

    runningRef.current = true;
    setPhase("running");

    const tick = async () => {
      if (!runningRef.current) return;

      let nextDelay = fallbackInterval(
        speedRef.current,
        safetyStateRef.current,
        lastHazardAtRef.current,
      );

      try {
        const photo = await cameraRef.current?.takePictureAsync({
          quality: JPEG_QUALITY,
          exif: false,
          // The shutter animation is a flash of white on a screen someone may
          // not be looking at, several times a minute.
          shutterSound: false,
        });

        if (!runningRef.current) return;

        if (photo?.uri) {
          sequenceRef.current += 1;
          const result = await processFrame({
            uri: photo.uri,
            journeyId,
            speedMps: speedRef.current,
            safetyState: safetyStateRef.current,
            sequence: sequenceRef.current,
            width: photo.width,
            height: photo.height,
          });

          if (!runningRef.current) return;

          setFramesSent((n) => n + 1);
          setError(null);
          setPhase("running");

          if (result.cadence) {
            setCadenceMode(result.cadence.mode);
            setCadenceFps(result.cadence.target_fps);
            nextDelay = clampInterval(result.cadence.next_frame_after_ms);
          }
          announce(result.hazards ?? [], safetyStateRef.current);
        }
      } catch (err) {
        if (!runningRef.current) return;
        nextDelay = EDGE_BACKOFF_MS;
        setPhase((previous) => {
          // Losing hazard coverage silently is the inverse of the failure this
          // design guards against: someone who cannot see the screen would go
          // on believing the path was being watched. Said once, on the way
          // down, not on every retry — and low priority, so it can never cut
          // across the safety conversation.
          if (previous !== "edge-unreachable") {
            const line = "Camera hazard alerts are unavailable right now.";
            speak(line, "environment");
            AccessibilityInfo.announceForAccessibility(line);
          }
          return "edge-unreachable";
        });
        setError(
          err instanceof EdgeError
            ? err.message
            : "Could not send a camera frame to the edge node.",
        );
      }

      if (!runningRef.current) return;
      timerRef.current = setTimeout(() => void tick(), nextDelay);
    };

    void tick();

    return () => {
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [shouldRun, journeyId, announce]);

  // A new journey is a new scene: nothing said about the last one should
  // suppress an announcement on this one.
  useEffect(() => {
    announcedRef.current.clear();
    lastHazardAtRef.current = null;
    sequenceRef.current = 0;
    setLastHazardSpoken(null);
    setFramesSent(0);
    setCadenceMode(null);
    setCadenceFps(null);
    setError(null);
  }, [journeyId]);

  return {
    cameraRef,
    active: Boolean(journeyId) && enabled && foreground,
    phase,
    onCameraReady,
    pictureSize,
    lastHazardSpoken,
    framesSent,
    cadenceMode,
    cadenceFps,
    error,
  };
}
