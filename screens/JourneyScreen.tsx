import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { ConnectionBadge } from "../components/ConnectionBadge";
import { HoldButton } from "../components/HoldButton";
import { CheckPathButton, JourneyCamera } from "../components/JourneyCamera";
import {
  PANIC_GESTURE_HINT,
  isPanicGestureSupported,
  subscribeToPanicKeys,
} from "../services/panicKeys";
import { JourneyMap } from "../components/JourneyMap";
import { NavigationBanner } from "../components/NavigationBanner";
import { JourneyStats } from "../components/JourneyStats";
import { PlacePanel } from "../components/PlacePanel";
import { PlacePickerModal } from "../components/PlacePickerModal";
import { RouteProgress } from "../components/RouteProgress";
import { SafetyStatusBanner } from "../components/SafetyStatusBanner";
import { VoiceButton } from "../components/VoiceButton";
import { TelemetryPanel } from "../components/TelemetryPanel";
import {
  colors,
  fontSize,
  fontWeight,
  radius,
  space,
  touchTarget,
} from "../constants/theme";
import type { JourneyMonitor, Telemetry } from "../hooks/useJourneyMonitor";
import { useCameraPerception } from "../hooks/useCameraPerception";
import { useVoiceControl } from "../hooks/useVoiceControl";

type Props = {
  monitor: JourneyMonitor;
};

/**
 * How much of the screen the map is allowed to take.
 *
 * It used to take three fifths of everything under the status band — roughly
 * 40% of the phone — and it pushed the evidence that AURA is actually watching
 * below the fold. That is backwards on this product: the traveller it is built
 * for cannot see the map at all. It is here for a sighted companion glancing
 * over and for the "where am I" question a picture answers faster than a
 * sentence, so it gets a fifth of the screen — a strip, not a panel — and it
 * goes last.
 *
 * A fraction of the window, not a remainder. The earlier attempt at sizing this
 * measured the window and subtracted an *estimate* of everything else, which
 * overshot the moment an ESCALATED headline wrapped to three lines, and pushed
 * the SOS off the bottom of the screen — the exact bug it was written to fix.
 * Nothing is estimated here: the map asks for a fixed share of the window, is
 * the only flexible thing above the footer, and yields that share back to
 * anything that genuinely needs it. The footer is a sibling outside the
 * flexible region, so the two controls that call for help still cannot be
 * squeezed by a long headline, an inset, a font scale or a row added later.
 */
const MAP_HEIGHT_FRACTION = 0.22;
/** The map stays a map, not a stripe, even when everything else is tall. */
const MAP_MIN_HEIGHT = 120;
/** And never creeps back towards half the screen on a tall device. */
const MAP_MAX_HEIGHT = 220;

/**
 * The active journey.
 *
 * Top to bottom, in the order the traveller needs them (AURA_DESIGN.md
 * sections 09 and 37):
 *
 *   1  the safety state — the verdict, and the largest type on the screen
 *   2  is AURA actually watching — live or stale, updates, GPS accuracy.
 *      For someone who cannot see the map this text *is* the reassurance.
 *   3  what it can see — the perception row, and the button that asks it now
 *   4  the controls that call for help, pinned to the bottom edge
 *   5  the map, small, last
 *
 * Everything above the scroll region is pinned, because a safety screen where
 * the important things need a scroll to reach is a safety screen that failed.
 * What scrolls is the reference material: saved places and raw telemetry.
 */
export function JourneyScreen({ monitor }: Props) {
  const {
    journey,
    safetyState,
    telemetry,
    lastReading,
    trail,
    plannedRoute,
    navigation,
    routeMonitoring,
    fix,
    online,
    queuedReadings,
    respondingToCheck,
    error,
    respond,
    stop,
    place,
    savePlace,
  } = monitor;

  const [pickingLabel, setPickingLabel] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Ending a journey stops safety monitoring, so it asks once — but as a second
  // tap rather than a dialog, which would be its own thing to dismiss.
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Volume down five times quickly raises the same SOS, silently. The
  // on-screen hold sounds an alarm on purpose; this is the path for when being
  // heard is itself the danger.
  useEffect(() => {
    return subscribeToPanicKeys(() => respond("HELP", { silent: true }));
  }, [respond]);

  useEffect(() => {
    if (!confirmEnd) return;
    // Long enough for a screen reader to announce the confirm prompt and the
    // traveller to act on it, short enough that a stray tap does not linger.
    const timer = setTimeout(() => setConfirmEnd(false), 6000);
    return () => clearTimeout(timer);
  }, [confirmEnd]);

  const destination = journey?.destination.name ?? null;

  const { height: windowHeight } = useWindowDimensions();
  // Opening details needs the room more than the map does.
  const mapHeight = showDetails
    ? MAP_MIN_HEIGHT
    : Math.min(
        MAP_MAX_HEIGHT,
        Math.max(MAP_MIN_HEIGHT, Math.round(windowHeight * MAP_HEIGHT_FRACTION)),
      );

  // "Where am I?" — one sentence, per AURA_DESIGN.md section 31.
  const describeLocation = () => {
    if (place.current) return `You're at ${place.current}.`;
    const destinationName = destination ?? "your destination";
    if (!telemetry) return `You're on your way to ${destinationName}.`;
    if (routeMonitoring && telemetry.deviationMeters >= 50) {
      return `You're about ${Math.round(telemetry.deviationMeters)} metres off your route to ${destinationName}.`;
    }
    return `You're on route to ${destinationName}.`;
  };

  // The camera is the last leg of the perception chain: frames go to the edge
  // node, the node's events reach the console over SSE, and what it finds on
  // the ground is spoken here. Speed and safety state are passed through as
  // readings — the node decides the sampling rate and what the hazard is.
  // Declared before the voice control, which needs its scan.
  const perception = useCameraPerception({
    journeyId: journey?.id ?? null,
    speedMps: lastReading?.speed_mps ?? 0,
    safetyState,
    // A full-screen safety check is not the moment to be told about pavement.
    enabled: safetyState !== "CHECKING",
  });

  const voice = useVoiceControl({
    onSafe: () => respond("SAFE"),
    onHelp: () => respond("HELP"),
    onStop: () => void stop(),
    describeLocation,
    // "What's in front of me?" — the same look the button does.
    onScan: perception.scanNow,
  });

  const mapLatitude = lastReading?.latitude ?? journey?.origin.latitude ?? 13.0827;
  const mapLongitude = lastReading?.longitude ?? journey?.origin.longitude ?? 80.2707;

  return (
    <View style={styles.screen}>
      {/* Everything except the footer, in one region that can shrink and clips
          its own overflow. The footer is then guaranteed by construction rather
          than by arithmetic: no headline, badge, inset or font scale above it
          has anywhere to push it to. Inside here the order is the priority
          order, and the map — the last thing in it — is what gives up room and,
          in the worst case, what gets clipped. Never the SOS. */}
      <View style={styles.region}>
        <SafetyStatusBanner
          state={safetyState}
          destination={destination}
          pausedAt={place.paused ? place.current : null}
          trailing={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                confirmEnd ? "Tap again to end the journey" : "End journey"
              }
              accessibilityHint="Stops sharing your location with AURA."
              onPress={() => {
                if (confirmEnd) {
                  setConfirmEnd(false);
                  void stop();
                } else {
                  setConfirmEnd(true);
                }
              }}
              style={({ pressed }) => [
                styles.endButton,
                confirmEnd && styles.endButtonConfirm,
                pressed && styles.pressedSurface,
              ]}
            >
              <Text style={[styles.endLabel, confirmEnd && styles.endLabelConfirm]}>
                {confirmEnd ? "Tap to confirm" : "End"}
              </Text>
            </Pressable>
          }
        />

        <View style={styles.body}>
          {/* Full width rather than squeezed in beside the status: "Offline · 14
              updates held" is the longest line on the screen and the one a
              traveller most needs to read in one go. */}
          {!online ? (
            <ConnectionBadge online={online} queuedReadings={queuedReadings} />
          ) : null}

          {/* Priority 2, and the reason it is this high: the map answers "am I
              being tracked?" only for someone who can see it. This answers it
              for everyone. */}
          <JourneyStats fix={fix} accuracyMeters={lastReading?.accuracy ?? null} />

          {/* Am I nearly there? The commonest question on the screen, and the
              numbers are the backend's own (AURA_DESIGN.md section 09).

              Only when there is a route to be along. Without one the backend
              still reports a telemetry row of zeros, which rendered as
              "0 m to go · 1 min planned" above an empty bar and directly above
              "No planned route" — two statements that cannot both be true, and
              the one in bigger type was the false one. */}
          {routeMonitoring ? (
            <RouteProgress
              progress={telemetry?.progress ?? null}
              remainingMeters={telemetry?.remainingMeters ?? null}
              etaSeconds={journey?.route.eta_seconds ?? null}
            />
          ) : null}

          {/* What to do next — or, with no route, what AURA is watching for
              instead. Spoken too, but never only spoken. */}
          <NavigationBanner instruction={navigation} routeMonitoring={routeMonitoring} />

          {/* Pinned, not scrolled: an error the traveller has to scroll to find
              is an error they will not find. */}
          {error ? (
            <View accessibilityRole="alert" style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Priority 3 and 4, kept together: what the camera can see, and the
              button that asks it to look now. Grouped by a tighter gap rather
              than by a box — the perception row draws its own surface when the
              camera is off, and a box around it would be a card on a card. */}
          <View style={styles.perception}>
            <JourneyCamera perception={perception} />
            <CheckPathButton perception={perception} />
          </View>

          {/* The only part that scrolls, and the least important part of the
              screen: a summary line, and reference material behind it. */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showDetails ? "Hide journey details" : "Show journey details"
              }
              accessibilityState={{ expanded: showDetails }}
              onPress={() => setShowDetails((open) => !open)}
              style={({ pressed }) => [
                styles.detailsToggle,
                pressed && styles.pressedRow,
              ]}
            >
              <Text style={styles.detailsLabel} numberOfLines={1}>
                {place.paused
                  ? `At ${place.current} — checks paused`
                  : summarise(telemetry, routeMonitoring)}
              </Text>
              <Text style={styles.detailsChevron}>{showDetails ? "Hide" : "Details"}</Text>
            </Pressable>

            {/* Inline rather than in a ScrollView of its own. Nesting a second
                vertical scroll here meant a drag near the place editor moved one
                list or the other depending on a few pixels, which is a poor
                target for anyone, and an impossible one for someone who cannot
                see which list they caught. The map shrinks to make the room
                instead. */}
            {showDetails ? (
              <>
                {/* Actionable first; telemetry is reference material. */}
                <PlacePanel
                  place={place}
                  canSave={lastReading !== null}
                  onSave={(label, radiusMeters) =>
                    void savePlace(label, undefined, radiusMeters)
                  }
                  onPickOnMap={(label) => setPickingLabel(label)}
                />
                <TelemetryPanel
                  telemetry={telemetry}
                  etaSeconds={journey?.route.eta_seconds ?? null}
                  distanceMeters={journey?.route.distance_meters ?? null}
                />
              </>
            ) : null}

            {isPanicGestureSupported ? (
              <Text style={styles.panicHint}>{PANIC_GESTURE_HINT}</Text>
            ) : null}
          </ScrollView>
        </View>

        {/* Priority 5. Last, and a quarter of the screen rather than nearly
            half. It is also the one thing above the footer that flexes, so a
            tall headline or a large font scale takes its room and not the
            room of anything that has to be read. */}
        <View style={[styles.mapSlot, { height: mapHeight }]}>
          <JourneyMap
            plannedRoute={plannedRoute}
            trail={trail}
            latitude={lastReading?.latitude ?? null}
            longitude={lastReading?.longitude ?? null}
            heading={lastReading?.heading ?? 0}
            safetyState={safetyState}
            places={place.saved}
          />
        </View>
      </View>

      {/* Outside the clipped region entirely.
          Held, not tapped: the SOS notifies a trusted contact and opens an
          incident, and there is no quiet undo. It has to be in the same place
          every single time, found by memory in the dark — the bottom edge of
          the screen, on every screen — so it sits outside the region that
          flexes rather than inside it. Nothing above can take its room: not a
          three-line ESCALATED headline, not the offline badge, not a safe-area
          inset, not a 200% font scale, not a row added later. */}
      <View style={styles.footer}>
        <VoiceButton
          listening={voice.listening}
          onPress={voice.listen}
          lastHeard={voice.lastHeard}
        />

        <HoldButton
          label="I need help"
          holdingLabel="Keep holding"
          busy={respondingToCheck}
          onActivate={() => respond("HELP")}
          accessibilityHint="Notifies your trusted contact."
        />
      </View>

      <PlacePickerModal
        visible={pickingLabel !== null}
        label={pickingLabel ?? ""}
        initialLatitude={mapLatitude}
        initialLongitude={mapLongitude}
        busy={place.saving}
        onCancel={() => setPickingLabel(null)}
        onConfirm={(latitude, longitude, radiusMeters) => {
          const label = pickingLabel;
          setPickingLabel(null);
          if (label) void savePlace(label, { latitude, longitude }, radiusMeters);
        }}
      />
    </View>
  );
}

/**
 * One short line for the details row, per AURA_DESIGN.md section 26:
 * "420 m off route" beats a chart.
 *
 * Every number here was measured by the backend and is only being worded, not
 * judged (CLAUDE.md rule 3) — and distance from a route is left unsaid when
 * there is no route to be off.
 */
function summarise(telemetry: Telemetry | null, routeMonitoring: boolean): string {
  if (!telemetry) return routeMonitoring ? "Following your route" : "Journey details";
  if (routeMonitoring && telemetry.deviationMeters >= 50) {
    return `${Math.round(telemetry.deviationMeters)} m off route`;
  }
  if (telemetry.inactivitySeconds >= 60) {
    const minutes = Math.round(telemetry.inactivitySeconds / 60);
    return `Stopped for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return routeMonitoring ? "On your way" : "Watching for long stops";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  endButton: {
    justifyContent: "center",
    minHeight: touchTarget.min,
    paddingHorizontal: space.compact,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  endButtonConfirm: {
    borderColor: colors.statusAttention,
    backgroundColor: colors.surfaceMuted,
  },
  endLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  endLabelConfirm: {
    // The amber border and the changed wording carry the confirm state; amber
    // text on surfaceMuted is 3.93:1, under AA for a 13px label.
    color: colors.text,
  },
  /** A pressed control has to look pressed, not just feel it. */
  pressedSurface: {
    backgroundColor: colors.surfaceMuted,
  },
  pressedRow: {
    opacity: 0.6,
  },
  /** Everything above the footer, and the boundary every overflow stops at. */
  region: {
    flex: 1,
    // Without this a flex child refuses to shrink past its content on some
    // layouts, which is how the overflow escapes the clip in the first place.
    minHeight: 0,
    overflow: "hidden",
  },
  /**
   * The reading part of the screen, on the page ground rather than on a white
   * sheet of its own. Every block inside it is a ruled surface, so a white
   * secondary button — Check the path — has a real edge to sit against instead
   * of a 1.35:1 border on white, and one gap value sets the rhythm for all of
   * it rather than each card inventing its own.
   */
  body: {
    // Grows into spare room, never shrinks. `flex: 1` would give it a zero
    // basis, and then a tall stack of rows — a 200% font scale, a wrapped
    // hazard sentence — would overflow this box and paint over the map instead
    // of pushing it. Refusing to shrink makes the map the one thing that gives
    // way, which is the whole point of putting it last.
    flexGrow: 1,
    flexShrink: 0,
    gap: space.compact,
    paddingHorizontal: space.default,
    paddingTop: space.compact,
  },
  /** The camera row and the button that asks it to look, as one unit. */
  perception: {
    gap: space.tight,
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
    // Never squeezed to nothing: at a large font scale the summary row is the
    // way into saved places and telemetry, and it has to stay touchable.
    minHeight: touchTarget.min,
  },
  scrollContent: {
    gap: space.compact,
    paddingBottom: space.compact,
  },
  /**
   * Ruled off from the reading part of the screen above it and the controls
   * below it — a hairline, not a shadow, and no rounded card floating on the
   * page (CLAUDE.md rules 4 and 5). `surfaceMuted` fills the slot while the
   * tiles load so it never flashes white.
   */
  mapSlot: {
    backgroundColor: colors.surfaceMuted,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    // The one thing above the footer that gives up room when something above it
    // needs more. It is the least costly thing on this screen to lose.
    flexShrink: 1,
    minHeight: MAP_MIN_HEIGHT,
  },
  /**
   * The controls, always at the bottom edge, always the same height. Its own
   * surface and its own rule, so it reads as the control bar and not as more
   * of the page.
   */
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    // Spelled out rather than relied upon: this must never give up height.
    flexShrink: 0,
    gap: space.compact,
    paddingBottom: space.default,
    paddingHorizontal: space.default,
    paddingTop: space.compact,
  },
  detailsToggle: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: space.compact,
    justifyContent: "space-between",
    minHeight: touchTarget.min,
  },
  detailsLabel: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  panicHint: {
    // Not textMuted: this line carries the whole instruction for raising a
    // silent SOS, and #8A8A84 on the page ground is 3.24:1 — below AA for body
    // text.
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    textAlign: "center",
  },
  detailsChevron: {
    color: colors.statusInfo,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  error: {
    backgroundColor: colors.surface,
    borderColor: colors.statusRisk,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.compact,
  },
  errorText: {
    color: colors.statusRisk,
    fontSize: fontSize.meta,
    lineHeight: 19,
  },
});
