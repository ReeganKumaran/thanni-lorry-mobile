/**
 * Owns one monitored journey: creates it, streams GPS into the backend, and
 * keeps the traveller-facing safety state in sync.
 *
 * The app deliberately holds no safety logic of its own (AURA_TRD.md section
 * 5.1). Every state here is read back from the backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CheckinResponse,
  Journey,
  KnownPlace,
  LocationUpdateBody,
  LocationUpdateResult,
  PendingSafetyCheck,
  RouteStatus,
  SafetyState,
} from "../types/api";
import {
  createJourney,
  createPlace,
  fetchPendingSafetyCheck,
  getSafetyStatus,
  listPlaces,
  respondToCheckin,
} from "../services/api";
import {
  LocationStreamer,
  getCurrentPosition,
  requestLocationPermission,
} from "../services/location";
import { presentSafetyState } from "../constants/safety";
import { speak, speakUrgent } from "../services/speech";

/** How often to ask the backend what it thinks the safety state is. */
const SAFETY_POLL_MS = 4000;

export type MonitorPhase = "idle" | "starting" | "active" | "error";

export type Telemetry = {
  routeStatus: RouteStatus;
  deviationMeters: number;
  etaDeltaSeconds: number;
  inactivitySeconds: number;
};

export type PlaceState = {
  /** Saved place the traveller is currently inside, if any. */
  current: string | null;
  /** True while inside one — AURA raises no safety checks. */
  paused: boolean;
  /** Every place saved so far. */
  saved: KnownPlace[];
  saving: boolean;
};

export type JourneyMonitor = {
  phase: MonitorPhase;
  error: string | null;
  journey: Journey | null;
  safetyState: SafetyState;
  telemetry: Telemetry | null;
  lastReading: LocationUpdateBody | null;
  pendingCheck: PendingSafetyCheck | null;
  place: PlaceState;
  /** Saves the given point, or the last GPS fix when no point is supplied. */
  savePlace: (
    label: string,
    coords?: { latitude: number; longitude: number },
  ) => Promise<void>;
  /** False while readings are queueing because the backend is unreachable. */
  online: boolean;
  queuedReadings: number;
  respondingToCheck: boolean;
  start: (destination: string) => Promise<void>;
  stop: () => Promise<void>;
  respond: (response: CheckinResponse) => Promise<void>;
  dismissError: () => void;
};

export function useJourneyMonitor(): JourneyMonitor {
  const [phase, setPhase] = useState<MonitorPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [safetyState, setSafetyState] = useState<SafetyState>("SAFE");
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [lastReading, setLastReading] = useState<LocationUpdateBody | null>(null);
  const [pendingCheck, setPendingCheck] = useState<PendingSafetyCheck | null>(null);
  const [online, setOnline] = useState(true);
  const [queuedReadings, setQueuedReadings] = useState(0);
  const [respondingToCheck, setRespondingToCheck] = useState(false);
  const [atPlace, setAtPlace] = useState<string | null>(null);
  const [monitoringPaused, setMonitoringPaused] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<KnownPlace[]>([]);
  const [savingPlace, setSavingPlace] = useState(false);

  const streamerRef = useRef<LocationStreamer>(new LocationStreamer());
  const journeyIdRef = useRef<string | null>(null);
  const safetyStateRef = useRef<SafetyState>("SAFE");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const streamer = streamerRef.current;
    return () => {
      mountedRef.current = false;
      void streamer.stop();
    };
  }, []);

  /**
   * Single funnel for safety state, whether it arrived on a location response
   * or a poll. Announces the change once, in plain language.
   */
  const applySafetyState = useCallback((next: SafetyState) => {
    if (safetyStateRef.current === next) return;
    safetyStateRef.current = next;
    setSafetyState(next);

    const presentation = presentSafetyState(next);
    if (next === "CHECKING") {
      speakUrgent(presentation.headline);
    } else {
      speak(`${presentation.headline} ${presentation.detail}`, "navigation");
    }

    if (next !== "CHECKING") setPendingCheck(null);
  }, []);

  const handleTelemetry = useCallback(
    (reading: LocationUpdateBody, result: LocationUpdateResult) => {
      if (!mountedRef.current) return;
      setLastReading(reading);
      setTelemetry({
        routeStatus: result.route_status,
        deviationMeters: result.deviation_meters,
        etaDeltaSeconds: result.eta_delta_seconds,
        inactivitySeconds: result.inactivity_seconds,
      });

      const place = result.at_place ?? null;
      setAtPlace((previous) => {
        if (previous === place) return previous;
        if (place) speak(`You're at ${place}. I'll stop checking in.`, "navigation");
        else if (previous) speak("Monitoring your journey again.", "navigation");
        return place;
      });
      setMonitoringPaused(result.monitoring_paused === true);

      applySafetyState(result.safety_state);
    },
    [applySafetyState],
  );

  const start = useCallback(
    async (destination: string) => {
      const trimmed = destination.trim();
      if (!trimmed) {
        setError("Tell AURA where you're heading first.");
        return;
      }

      setPhase("starting");
      setError(null);

      try {
        const permission = await requestLocationPermission();
        if (!permission.granted) {
          setPhase("error");
          setError(
            permission.blocked
              ? "Location is turned off for AURA. Turn it on in Settings to be monitored."
              : "AURA needs your location to monitor this journey.",
          );
          return;
        }

        // Start the journey from where the traveller actually is, so route
        // deviation is measured against a real origin.
        let origin: LocationUpdateBody | null = null;
        try {
          origin = await getCurrentPosition();
        } catch {
          origin = null;
        }

        const created = await createJourney({
          destination_text: trimmed,
          ...(origin
            ? {
                origin: {
                  latitude: origin.latitude,
                  longitude: origin.longitude,
                  name: "Current location",
                },
              }
            : {}),
        });

        if (!mountedRef.current) return;

        journeyIdRef.current = created.id;
        safetyStateRef.current = created.safety_state;
        setJourney(created);
        setSafetyState(created.safety_state);
        setTelemetry(null);
        setLastReading(origin);
        setPendingCheck(null);
        setQueuedReadings(0);
        setOnline(true);
        setPhase("active");

        await streamerRef.current.start(created.id, {
          onTelemetry: handleTelemetry,
          onConnectionChange: (isOnline) => {
            if (mountedRef.current) setOnline(isOnline);
          },
          onBufferChange: (count) => {
            if (mountedRef.current) setQueuedReadings(count);
          },
          onError: () => {
            // Buffered and retried by the streamer; the banner carries the state.
          },
        });

        // The screen can go away while the watcher is being attached.
        if (!mountedRef.current) {
          await streamerRef.current.stop();
          return;
        }

        speak(
          `Monitoring your journey to ${created.destination.name ?? trimmed}.`,
          "navigation",
        );
      } catch (err) {
        if (!mountedRef.current) return;
        setPhase("error");
        setError(err instanceof Error ? err.message : "Could not start the journey.");
      }
    },
    [handleTelemetry],
  );

  const stop = useCallback(async () => {
    await streamerRef.current.stop();
    journeyIdRef.current = null;
    safetyStateRef.current = "SAFE";
    setPhase("idle");
    setJourney(null);
    setTelemetry(null);
    setLastReading(null);
    setPendingCheck(null);
    setSafetyState("SAFE");
    setQueuedReadings(0);
    setAtPlace(null);
    setMonitoringPaused(false);
    setError(null);
  }, []);

  const respond = useCallback(async (response: CheckinResponse) => {
    const journeyId = journeyIdRef.current;
    if (!journeyId) return;

    setRespondingToCheck(true);
    try {
      const result = await respondToCheckin(journeyId, response);
      if (!mountedRef.current) return;
      setPendingCheck(null);
      safetyStateRef.current = result.new_safety_state;
      setSafetyState(result.new_safety_state);
      speakUrgent(
        response === "HELP"
          ? "I'm here. I'm notifying your trusted contact now."
          : "Okay. I'll keep monitoring your journey.",
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Could not send your answer to AURA.",
      );
    } finally {
      if (mountedRef.current) setRespondingToCheck(false);
    }
  }, []);

  // Poll the backend for safety state. Location responses carry it too, but a
  // check-in can be raised by the agent between GPS fixes.
  useEffect(() => {
    if (phase !== "active") return;

    let cancelled = false;

    const poll = async () => {
      const journeyId = journeyIdRef.current;
      if (!journeyId) return;

      try {
        const status = await getSafetyStatus(journeyId);
        if (cancelled || !mountedRef.current) return;
        applySafetyState(status.safety_state);
      } catch {
        // The streamer already surfaces connectivity; nothing to add here.
      }
    };

    void poll();
    const timer = setInterval(poll, SAFETY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, applySafetyState]);

  // Pull the prompt text once a check-in is outstanding.
  useEffect(() => {
    if (safetyState !== "CHECKING" || pendingCheck !== null) return;

    let cancelled = false;
    const journeyId = journeyIdRef.current;
    if (!journeyId) return;

    void (async () => {
      try {
        const check = await fetchPendingSafetyCheck(journeyId);
        if (cancelled || !mountedRef.current || !check) return;
        setPendingCheck(check);
        speakUrgent(check.message);
      } catch {
        // Fall back to the generic prompt rendered by the modal.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [safetyState, pendingCheck]);

  const refreshPlaces = useCallback(async () => {
    try {
      const places = await listPlaces();
      if (mountedRef.current) setSavedPlaces(places);
    } catch {
      // Non-critical: the save buttons still work without the current list.
    }
  }, []);

  /** Save wherever the traveller is standing as Home, Office or College. */
  const savePlace = useCallback(
    async (label: string, coords?: { latitude: number; longitude: number }) => {
      const point = coords ?? lastReading;
      if (!point) {
        setError("Waiting for a GPS fix before this spot can be saved.");
        return;
      }

      setSavingPlace(true);
      try {
        await createPlace(label, point.latitude, point.longitude);
        if (!mountedRef.current) return;
        // Only claim to be there when the point came from the live GPS fix.
        if (!coords) {
          setAtPlace(label);
          setMonitoringPaused(true);
        }
        speak(
          coords
            ? `${label} saved. I won't check in while you're there.`
            : `Saved as ${label}. I won't check in while you're here.`,
          "navigation",
        );
        await refreshPlaces();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : `Could not save ${label}.`);
      } finally {
        if (mountedRef.current) setSavingPlace(false);
      }
    },
    [lastReading, refreshPlaces],
  );

  useEffect(() => {
    if (phase === "active") void refreshPlaces();
  }, [phase, refreshPlaces]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    phase,
    error,
    journey,
    safetyState,
    telemetry,
    lastReading,
    pendingCheck,
    place: {
      current: atPlace,
      paused: monitoringPaused,
      saved: savedPlaces,
      saving: savingPlace,
    },
    savePlace,
    online,
    queuedReadings,
    respondingToCheck,
    start,
    stop,
    respond,
    dismissError,
  };
}
