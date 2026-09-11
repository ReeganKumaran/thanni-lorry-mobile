/**
 * Owns one monitored journey: creates it, streams GPS into the backend, and
 * keeps the traveller-facing safety state in sync.
 *
 * The app deliberately holds no safety logic of its own (AURA_TRD.md section
 * 5.1). Every state here is read back from the backend.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { DEFAULT_PLACE_SIZE, metersForSize } from "../types/api";
import type {
  NavigationInstruction,
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
  completeJourney,
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
import { journeyIdentity } from "../services/device";
import { speak, speakUrgent } from "../services/speech";

/** How often to ask the backend what it thinks the safety state is. */
const SAFETY_POLL_MS = 4000;

/** [longitude, latitude] — the order the backend and both maps already use. */
export type RoutePoint = [number, number];

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
  /** Distance still to walk, computed by the backend against the planned route. */
  remainingMeters: number;
  /** Route completed, 0..1, already clamped by the backend. */
  progress: number;
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
  /** Planned route, when the backend could work one out. */
  plannedRoute: RoutePoint[];
  /**
   * The next instruction, as the backend computed it. Displayed continuously;
   * spoken only when its `key` changes.
   */
  navigation: NavigationInstruction | null;
  /** False when there is no route, so deviation is not being watched. */
  routeMonitoring: boolean;
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
 * Destination resolution, route planning and the personal-label guards
 * ("Home" is not the town of Home, Washington) all moved to the backend —
 * `app/journey/planner.py`. The phone posts what the traveller typed and where
 * they are standing, and reads back a polyline.
 *
 * This is not a tidying exercise. The planned route is the line deviation is
 * measured against, so whoever chooses it decides what "off route" means, and
 * on this product a deviation wakes a trusted contact (AURA_TRD.md section 5.1).
 */

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
  const [navigation, setNavigation] = useState<NavigationInstruction | null>(null);
  const [routeMonitoring, setRouteMonitoring] = useState(false);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const [fixCount, setFixCount] = useState(0);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const streamerRef = useRef<LocationStreamer>(new LocationStreamer());
  const journeyIdRef = useRef<string | null>(null);
  const safetyStateRef = useRef<SafetyState>("SAFE");
  /**
   * The instruction key last spoken aloud.
   *
   * The backend buckets this key by distance and keeps it stable across fixes
   * for the same instruction, so comparing it is what turns a 1 Hz GPS stream
   * into a handful of announcements. Speaking on every fix would be worse than
   * silence for a traveller who is relying on audio alone.
   */
  const spokenNavKeyRef = useRef<string | null>(null);
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
    // expo-speech is a separate pipeline from the screen reader — it can be
    // muted on its own, and it reaches nobody on a braille display. A change
    // of safety state is the one thing that must never be missed, so it goes
    // out on both channels.
    AccessibilityInfo.announceForAccessibility(presentation.headline);

    if (next !== "CHECKING") setPendingCheck(null);
  }, []);

  /**
   * Show every instruction; speak only the ones that are new.
   *
   * `navigation` priority sits below `safety` and `hazard` in the audio ladder
   * (AURA_DESIGN.md section 32), so a turn is never spoken over "Are you safe?"
   * or over a warning about the pavement.
   */
  const applyNavigation = useCallback((next: NavigationInstruction | null) => {
    setNavigation(next);
    if (!next) return;
    if (spokenNavKeyRef.current === next.key) return;

    const outcome = speak(next.text, "navigation");

    // Only retire the key once the traveller has actually had the words. A turn
    // that lost the floor to a safety check-in or a hazard callout must be
    // offered again on the next fix — marking it spoken regardless meant
    // "Turn left now." could be dropped silently and never repeated, which on
    // the audio-only path is the difference between a turn and a missed one.
    // "duplicate" counts as heard: those exact words went out moments ago.
    if (outcome === "outranked") return;
    spokenNavKeyRef.current = next.key;

    // expo-speech is a separate pipeline from the screen reader: it can be
    // muted on its own, and it reaches nobody on a braille display. Android
    // gets this from the banner's live region; iOS has no live-region
    // equivalent for a View, so the announcement is made explicitly there.
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(next.text);
    }
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
        remainingMeters: result.remaining_meters,
        progress: result.progress,
      });
      applyNavigation(result.navigation ?? null);

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
    [applySafetyState, applyNavigation],
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

        // The backend resolves the destination and plans the route. It knows the
        // traveller's saved places, holds the maps credential, and is the only
        // place allowed to decide what line "off route" is measured against.
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
          // Identity for the trusted contact and operations consoles, so a row
          // reads "Sai · Pixel 8" rather than a journey id. Never safety input.
          ...(await journeyIdentity()),
        });

        // Whatever it managed to plan, read back rather than assumed.
        const route = (created.route?.geometry?.coordinates ?? []) as RoutePoint[];

        if (!mountedRef.current) return;

        journeyIdRef.current = created.id;
        safetyStateRef.current = created.safety_state;
        setJourney(created);
        setSafetyState(created.safety_state);
        setTelemetry(null);
        setLastReading(origin);
        setPendingCheck(null);
        setPlannedRoute(route);
        setRouteMonitoring(created.route_monitoring);
        setNavigation(null);
        spokenNavKeyRef.current = null;
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

        // Say what was actually planned. "I couldn't find that place, so I'm
        // only watching for long stops" is a materially different promise from
        // "I'm monitoring your route", and the traveller is entitled to know
        // which one they are getting before they set off.
        speak(
          created.route_monitoring
            ? `Monitoring your journey to ${created.destination.name ?? trimmed}.`
            : created.planning_note ??
                `I couldn't plan a route to ${trimmed}. I'll still watch for long stops.`,
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

    // Close the journey server-side. Without this a finished journey stays
    // ACTIVE forever: the phone simply goes quiet, which is indistinguishable
    // from a dead battery, so it sits on the operations board as a traveller
    // nobody can account for.
    //
    // Deliberately not awaited into the teardown path and never allowed to
    // throw — ending a journey must succeed on the phone even with no network.
    const endingJourneyId = journeyIdRef.current;
    if (endingJourneyId) {
      void completeJourney(endingJourneyId).catch(() => {
        // The backend times the journey out on its own; nothing to retry here.
      });
    }

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
    setNavigation(null);
    setRouteMonitoring(false);
    spokenNavKeyRef.current = null;
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
        // The same instruction the last location response carried. Keyed, so
        // reading it again here cannot cause a repeat announcement — but a
        // dropped GPS response no longer costs the traveller their next turn.
        if (status.navigation !== undefined) applyNavigation(status.navigation ?? null);
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
  }, [phase, applySafetyState, applyNavigation]);

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
    navigation,
    routeMonitoring,
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
