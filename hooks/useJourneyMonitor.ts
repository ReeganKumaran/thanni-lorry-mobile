/**
 * Owns one monitored journey: creates it, streams GPS into the backend, and
 * keeps the traveller-facing safety state in sync.
 *
 * The app deliberately holds no safety logic of its own (AURA_TRD.md section
 * 5.1). Every state here is read back from the backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_PLACE_SIZE, metersForSize } from "../types/api";
import { directRoute, fetchWalkingRoute } from "../services/routing";
import type { RoutePoint } from "../services/routing";
import { searchPlaces } from "../services/geocoding";
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
import { activatedFeedback } from "../services/haptics";
import { presentSafetyState } from "../constants/safety";
import { speak, speakUrgent } from "../services/speech";

/** How often to ask the backend what it thinks the safety state is. */
const SAFETY_POLL_MS = 4000;

/**
 * The trail drawn on the map. Points closer together than this add nothing but
 * memory, and the cap keeps a long walk from growing without bound.
 */
const TRAIL_MIN_SPACING_METERS = 6;
const MAX_TRAIL_POINTS = 2000;

export type MonitorPhase = "idle" | "starting" | "active" | "error";

export type Telemetry = {
  routeStatus: RouteStatus;
  deviationMeters: number;
  etaDeltaSeconds: number;
  inactivitySeconds: number;
};

/** One step of where the traveller has actually been. */
export type TrailPoint = {
  latitude: number;
  longitude: number;
  safetyState: SafetyState;
};

/**
 * Evidence that tracking is actually working.
 *
 * A monitoring app that has quietly stopped receiving fixes looks identical to
 * one that is working, so the journey screen shows this rather than implying it.
 */
export type FixState = {
  /** Epoch ms of the most recent GPS fix, null before the first. */
  lastFixAt: number | null;
  /** How many fixes this journey has produced. */
  count: number;
  /** Metres walked, summed along the trail. */
  distanceMeters: number;
  /** Epoch ms the journey started. */
  startedAt: number | null;
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
  /** Actual route walked so far, for the map. */
  trail: TrailPoint[];
  /** Planned route, when one could be worked out. */
  plannedRoute: RoutePoint[];
  /** Live proof that GPS is still arriving. */
  fix: FixState;
  pendingCheck: PendingSafetyCheck | null;
  place: PlaceState;
  /** Saves the given point, or the last GPS fix when no point is supplied. */
  savePlace: (
    label: string,
    coords?: { latitude: number; longitude: number },
    radiusMeters?: number,
  ) => Promise<void>;
  /** False while readings are queueing because the backend is unreachable. */
  online: boolean;
  queuedReadings: number;
  respondingToCheck: boolean;
  start: (destination: string) => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Answer an outstanding check, or raise an SOS outright.
   *
   * `silent` suppresses the spoken confirmation for the covert panic gesture,
   * which exists precisely for when being heard is the danger. A haptic burst
   * takes its place so the traveller still knows it landed.
   */
  respond: (response: CheckinResponse, options?: { silent?: boolean }) => Promise<void>;
  dismissError: () => void;
};

function roughDistanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const metresPerDegree = 111_320;
  const dLat = (a.latitude - b.latitude) * metresPerDegree;
  const dLng =
    (a.longitude - b.longitude) *
    metresPerDegree *
    Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Turn what the traveller typed into coordinates.
 *
 * Their own saved places win: "Home" should mean their home, not the nearest
 * place OpenStreetMap happens to call that.
 */
async function resolveDestination(
  text: string,
  saved: KnownPlace[],
): Promise<{ latitude: number; longitude: number } | null> {
  const match = saved.find((p) => p.label.toLowerCase() === text.toLowerCase());
  if (match) return { latitude: match.latitude, longitude: match.longitude };

  try {
    const [first] = await searchPlaces(text);
    return first ? { latitude: first.latitude, longitude: first.longitude } : null;
  } catch {
    return null;
  }
}

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
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [plannedRoute, setPlannedRoute] = useState<RoutePoint[]>([]);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const [fixCount, setFixCount] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

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

        // A planned route is what makes "off route" mean anything. Resolve the
        // destination first: a saved place is exact and free, otherwise fall
        // back to searching OpenStreetMap for the text the traveller typed.
        let route: RoutePoint[] = [];
        if (origin) {
          const destination = await resolveDestination(trimmed, savedPlaces);
          if (destination) {
            // A straight line beats no route at all: deviation needs something
            // to measure against, and the router is often unusable here.
            const planned =
              (await fetchWalkingRoute(origin, destination)) ??
              directRoute(origin, destination);
            route = planned.coordinates;
          }
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
          ...(route.length >= 2 ? { route } : {}),
        });

        if (!mountedRef.current) return;

        journeyIdRef.current = created.id;
        safetyStateRef.current = created.safety_state;
        setJourney(created);
        setSafetyState(created.safety_state);
        setTelemetry(null);
        setLastReading(origin);
        setPendingCheck(null);
        setPlannedRoute(route);
        setQueuedReadings(0);
        setOnline(true);
        setLastFixAt(null);
        setFixCount(0);
        setDistanceMeters(0);
        setStartedAt(Date.now());
        setPhase("active");

        await streamerRef.current.start(created.id, {
          onTelemetry: handleTelemetry,
          onReadingCaptured: (reading) => {
            if (!mountedRef.current) return;
            setLastReading(reading);
            setLastFixAt(Date.now());
            setFixCount((n) => n + 1);
            setTrail((previous) => {
              const last = previous[previous.length - 1];
              if (last && roughDistanceMeters(last, reading) < TRAIL_MIN_SPACING_METERS) {
                return previous;
              }
              if (last) {
                const step = roughDistanceMeters(last, reading);
                // Ignore obvious GPS jumps rather than inflating the total.
                if (step < 100) setDistanceMeters((d) => d + step);
              }
              const next = [
                ...previous,
                {
                  latitude: reading.latitude,
                  longitude: reading.longitude,
                  safetyState: safetyStateRef.current,
                },
              ];
              return next.length > MAX_TRAIL_POINTS
                ? next.slice(next.length - MAX_TRAIL_POINTS)
                : next;
            });
          },
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
    [handleTelemetry, savedPlaces],
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
    setTrail([]);
    setPlannedRoute([]);
    setLastFixAt(null);
    setFixCount(0);
    setDistanceMeters(0);
    setStartedAt(null);
    setError(null);
  }, []);

  const respond = useCallback(
    async (response: CheckinResponse, options?: { silent?: boolean }) => {
    const journeyId = journeyIdRef.current;
    if (!journeyId) return;

    setRespondingToCheck(true);
    try {
      const result = await respondToCheckin(journeyId, response);
      if (!mountedRef.current) return;
      setPendingCheck(null);
      safetyStateRef.current = result.new_safety_state;
      setSafetyState(result.new_safety_state);
      if (options?.silent) {
        // The covert gesture must not announce itself: saying "I'm notifying
        // your trusted contact now" out loud is exactly the outcome it was
        // built to avoid. A haptic burst confirms it without being overheard.
        activatedFeedback();
      } else {
        speakUrgent(
          response === "HELP"
            ? "I'm here. I'm notifying your trusted contact now."
            : "Okay. I'll keep monitoring your journey.",
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Could not send your answer to AURA.",
      );
    } finally {
      if (mountedRef.current) setRespondingToCheck(false);
    }
    },
    [],
  );

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
    async (
      label: string,
      coords?: { latitude: number; longitude: number },
      radiusMeters: number = metersForSize(DEFAULT_PLACE_SIZE),
    ) => {
      setSavingPlace(true);

      let point = coords ?? lastReading;
      if (!point) {
        // No journey running, so there is no GPS stream to borrow from.
        try {
          const permission = await requestLocationPermission();
          if (!permission.granted) {
            setError(
              "AURA needs your location to save this spot. Use \u201COn map\u201D instead.",
            );
            setSavingPlace(false);
            return;
          }
          point = await getCurrentPosition();
        } catch {
          setError("Couldn't get a GPS fix. Use \u201COn map\u201D instead.");
          setSavingPlace(false);
          return;
        }
      }

      try {
        await createPlace(label, point.latitude, point.longitude, radiusMeters);
        if (!mountedRef.current) return;
        // Only claim to be there when the point came from the live GPS fix.
        if (!coords && phase === "active") {
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
    [lastReading, refreshPlaces, phase],
  );

  useEffect(() => {
    void refreshPlaces();
  }, [phase, refreshPlaces]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    phase,
    error,
    journey,
    safetyState,
    telemetry,
    lastReading,
    trail,
    plannedRoute,
    fix: { lastFixAt, count: fixCount, distanceMeters, startedAt },
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
