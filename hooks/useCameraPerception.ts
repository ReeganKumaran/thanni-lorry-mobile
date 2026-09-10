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

import { EdgeError, outcomeOf, processFrame, spokenFor } from "../services/perception";
import type { EdgeHazard, ProcessFrameResult } from "../services/perception";
import { speak } from "../services/speech";
import { tapFeedback } from "../services/haptics";

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

/**
 * How many clear frames in a row before saying the path is clear again.
 *
 * Only after a hazard has actually been announced — this is the "it has
 * changed back" signal, not a running commentary. One clear frame is noise;
 * three in a row is a change.
 */
const CLEAR_AGAIN_AFTER_FRAMES = 3;

export type PerceptionPhase =
  | "idle"
  | "no-permission"
  | "waiting-for-camera"
  | "running"
  /** Deliberately stopped because AURA is not the app in front. */
  | "paused"
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
  /** Look right now, because the traveller asked. */
  scanNow: () => void;
  /** True while an explicitly requested scan is in flight. */
  scanning: boolean;
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
  const [scanning, setScanning] = useState(false);
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
  // One capture at a time: takePictureAsync does not like being re-entered,
  // and a requested scan must not race the passive loop.
  const captureRef = useRef(false);
  const scanSequenceRef = useRef(0);
  const clearRunRef = useRef(0);
  const hazardAnnouncedRef = useRef(false);

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

  const announce = useCallback((
    hazards: EdgeHazard[],
    safetyState: string,
    requested = false,
  ) => {
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
    // The anti-repeat window exists so a hazard that stays in frame is not read
    // out over and over. It must not apply when the traveller has just asked —
    // an unanswered question is the failure this whole affordance exists to fix.
    if (!requested && spokenAt !== undefined && now - spokenAt < HAZARD_REANNOUNCE_MS) {
      return;
    }

    announcedRef.current.set(key, now);
    hazardAnnouncedRef.current = true;
    clearRunRef.current = 0;
    speak(sentence, "hazard");
    // The app's own text-to-speech is a separate pipeline from the screen
    // reader: it can be muted on its own, and it is no use at all to someone
    // reading a braille display. Announce through both.
    AccessibilityInfo.announceForAccessibility(sentence);
    setLastHazardSpoken(sentence);
  }, []);

  /**
   * Take one frame and send it. Shared by the passive loop and by an explicit
   * scan so the two cannot drift apart, and serialised because
   * takePictureAsync does not tolerate being re-entered.
   */
  const captureAndSend = useCallback(
    async (id: string, scanNow = false): Promise<ProcessFrameResult | null> => {
      if (captureRef.current) return null;
      captureRef.current = true;
      try {
        const photo = await cameraRef.current?.takePictureAsync({
          quality: JPEG_QUALITY,
          exif: false,
          // The shutter animation is a flash of white on a screen someone may
          // not be looking at, several times a minute.
          shutterSound: false,
        });
        if (!photo?.uri) return null;

        sequenceRef.current += 1;
        return await processFrame({
          uri: photo.uri,
          journeyId: id,
          speedMps: speedRef.current,
          safetyState: safetyStateRef.current,
          sequence: sequenceRef.current,
          width: photo.width,
          height: photo.height,
          scanNow,
        });
      } finally {
        captureRef.current = false;
      }
    },
    [],
  );

  /**
   * Look now, because the traveller asked.
   *
   * Answered out loud whatever the outcome. A question that gets silence is
   * indistinguishable from an app that has stopped working, and that is
   * precisely what standing still and aiming the phone used to produce: at
   * 0.2 FPS the next frame was up to five seconds away, and the one after it
   * was dropped as a duplicate.
   */
  const scanNow = useCallback(() => {
    if (!journeyId || scanning) return;

    void (async () => {
      setScanning(true);
      tapFeedback();
      try {
        scanSequenceRef.current += 1;
        // scan_now bypasses the node's cadence limiter and its repeat window,
        // so a question always gets an answer.
        const result = await captureAndSend(journeyId, true);
        if (!result) {
          speak("I couldn't use the camera just then.", "requested");
          return;
        }

        setFramesSent((n) => n + 1);
        setError(null);
        if (result.cadence) {
          setCadenceMode(result.cadence.mode);
          setCadenceFps(result.cadence.target_fps);
        }

        const outcome = outcomeOf(result);
        if (outcome === "hazard") {
          announce(result.hazards ?? [], safetyStateRef.current, true);
          return;
        }

        // The node writes this sentence, including the negative — it says
        // "nothing I can recognise is in your way", never "the path is clear",
        // because it cannot see kerbs, steps or open manholes.
        const reply = spokenFor(result, outcome);
        speak(reply, "requested");
        AccessibilityInfo.announceForAccessibility(reply);
        setLastHazardSpoken(reply);
      } catch (err) {
        const line =
          err instanceof EdgeError
            ? "I can't reach the hazard camera right now."
            : "I couldn't check just then.";
        speak(line, "requested");
        AccessibilityInfo.announceForAccessibility(line);
        setError(line);
      } finally {
        setScanning(false);
      }
    })();
  }, [announce, captureAndSend, journeyId, scanning]);

  const shouldRun = Boolean(journeyId) && enabled && cameraReady && foreground;

  useEffect(() => {
    if (!shouldRun || !journeyId) {
      runningRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;

      if (!journeyId) {
        setPhase("idle");
      } else if (!foreground) {
        // Stopping on background is deliberate — battery and privacy — but the
        // last thing on screen was whatever state capture was in when it
        // stopped, and a leftover connection error reads as a fault. Say what
        // actually happened instead.
        setError(null);
        setPhase("paused");
      } else {
        setPhase("waiting-for-camera");
      }
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
        const result = await captureAndSend(journeyId);

        if (!runningRef.current) return;

        if (result) {
          setFramesSent((n) => n + 1);
          setError(null);
          setPhase("running");

          if (result.cadence) {
            setCadenceMode(result.cadence.mode);
            setCadenceFps(result.cadence.target_fps);
            nextDelay = clampInterval(result.cadence.next_frame_after_ms);
          }

          const outcome = outcomeOf(result);
          announce(result.hazards ?? [], safetyStateRef.current);

          // Say it once when a hazard that WAS announced has gone. That is a
          // change worth knowing about; a clear frame on its own is not.
          if (outcome === "clear") {
            clearRunRef.current += 1;
            if (
              hazardAnnouncedRef.current &&
              clearRunRef.current >= CLEAR_AGAIN_AFTER_FRAMES &&
              safetyStateRef.current === "SAFE"
            ) {
              hazardAnnouncedRef.current = false;
              clearRunRef.current = 0;
              const line = "The pavement ahead looks clear again.";
              speak(line, "navigation");
              AccessibilityInfo.announceForAccessibility(line);
              setLastHazardSpoken(line);
            }
          } else if (outcome !== "unchanged") {
            clearRunRef.current = 0;
          }
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
  }, [shouldRun, journeyId, foreground, announce, captureAndSend]);

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
    clearRunRef.current = 0;
    hazardAnnouncedRef.current = false;
    scanSequenceRef.current = 0;
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
    scanNow,
    scanning,
  };
}
