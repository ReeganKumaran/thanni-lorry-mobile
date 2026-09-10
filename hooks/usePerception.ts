import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraView } from "expo-camera";

import { speak } from "../services/speech";
import { isEdgeReachable, sendFrame } from "../services/perception";
import type { FrameResult } from "../services/perception";

/** Used only until the edge answers with a cadence of its own. */
const INITIAL_INTERVAL_MS = 700;

/** Back off rather than hammer a node that is not answering. */
const UNREACHABLE_RETRY_MS = 5000;

/** Small and rough: this is fed to a detector, not shown to anyone. */
const CAPTURE_OPTIONS = {
  quality: 0.35,
  base64: false,
  exif: false,
  skipProcessing: true,
  shutterSound: false,
} as const;

export type PerceptionState = {
  /** Frames are being captured and sent. */
  running: boolean;
  /** The edge answered at least once. */
  connected: boolean;
  /** Last line of guidance, for anyone who can see the screen. */
  guidance: string | null;
  framesSent: number;
  /** How often the edge currently wants frames, and why. */
  cadence: string | null;
  start: () => void;
  stop: () => void;
  /** "What's in front of me?" — answer now, bypassing the schedule. */
  scanNow: () => void;
};

type Options = {
  cameraRef: React.RefObject<CameraView | null>;
  journeyId: string | null;
  speedMps: number;
  safetyState: string;
  enabled: boolean;
};

/**
 * Streams camera frames to the edge node and speaks what comes back.
 *
 * The loop is self-scheduling rather than a fixed interval: each response
 * carries `next_frame_after_ms`, so the node slows us down when the traveller
 * is standing still and speeds us up during an alert. A fixed timer would
 * either waste battery or miss the moment that mattered.
 */
export function usePerception({
  cameraRef,
  journeyId,
  speedMps,
  safetyState,
  enabled,
}: Options): PerceptionState {
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [framesSent, setFramesSent] = useState(0);
  const [cadence, setCadence] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const sequenceRef = useRef(0);
  const runningRef = useRef(false);
  const latest = useRef({ journeyId, speedMps, safetyState });

  latest.current = { journeyId, speedMps, safetyState };

  const announce = useCallback((result: FrameResult) => {
    // The edge already suppresses repeats and decides what is worth saying;
    // AURA_DESIGN.md section 10 wants guidance, not a detection feed.
    if (result.clear || result.duplicate || !result.summary?.trim()) return;

    const hazardous = result.hazards?.some(
      (h) => h.severity === "high" || h.distance_estimate === "immediate",
    );
    speak(result.summary.trim(), hazardous ? "hazard" : "environment");
    setGuidance(result.summary.trim());
  }, []);

  const captureOnce = useCallback(
    async (scanNow = false): Promise<number> => {
      const { journeyId: id, speedMps: speed, safetyState: state } = latest.current;
      const camera = cameraRef.current;
      if (!camera || !id) return INITIAL_INTERVAL_MS;

      let uri: string | undefined;
      try {
        const photo = await camera.takePictureAsync(CAPTURE_OPTIONS);
        uri = photo?.uri;
      } catch {
        return INITIAL_INTERVAL_MS;
      }
      if (!uri) return INITIAL_INTERVAL_MS;

      sequenceRef.current += 1;
      const result = await sendFrame({
        journeyId: id,
        uri,
        sequence: sequenceRef.current,
        speedMps: speed,
        safetyState: state,
        scanNow,
      });

      if (!result) {
        setConnected(false);
        return UNREACHABLE_RETRY_MS;
      }

      setConnected(true);
      setFramesSent((n) => n + 1);
      if (result.cadence) {
        setCadence(`${result.cadence.mode} · ${result.cadence.target_fps} fps`);
      }
      announce(result);

      return result.cadence?.next_frame_after_ms ?? INITIAL_INTERVAL_MS;
    },
    [announce, cameraRef],
  );

  const schedule = useCallback(
    (delayMs: number) => {
      if (!runningRef.current) return;
      timerRef.current = setTimeout(async () => {
        if (!runningRef.current || busyRef.current) return;
        busyRef.current = true;
        let next = INITIAL_INTERVAL_MS;
        try {
          next = await captureOnce();
        } finally {
          busyRef.current = false;
        }
        schedule(next);
      }, delayMs);
    },
    [captureOnce],
  );

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setRunning(false);
    setCadence(null);
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    sequenceRef.current = 0;

    void (async () => {
      const reachable = await isEdgeReachable();
      setConnected(reachable);
      if (!reachable) {
        speak("The vision node isn't reachable. I'll keep trying.", "requested");
      }
      schedule(reachable ? 0 : UNREACHABLE_RETRY_MS);
    })();
  }, [schedule]);

  const scanNow = useCallback(() => {
    void (async () => {
      const { journeyId: id } = latest.current;
      if (!id) {
        speak("Start a journey first.", "requested");
        return;
      }
      if (!cameraRef.current) {
        speak("The camera isn't ready.", "requested");
        return;
      }
      const result = await captureOnce(true);
      if (result === UNREACHABLE_RETRY_MS) {
        speak("I can't reach the vision node right now.", "requested");
      }
    })();
  }, [captureOnce, cameraRef]);

  // Tie the loop to the journey, so nothing is captured off-journey.
  useEffect(() => {
    if (!enabled) stop();
    return stop;
  }, [enabled, stop]);

  return { running, connected, guidance, framesSent, cadence, start, stop, scanNow };
}
