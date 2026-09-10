import { useEffect, useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ConnectionBadge } from "../components/ConnectionBadge";
import { HoldButton } from "../components/HoldButton";
import { JourneyCamera } from "../components/JourneyCamera";
import {
  PANIC_GESTURE_HINT,
  isPanicGestureSupported,
  subscribeToPanicKeys,
} from "../services/panicKeys";
import { JourneyMap } from "../components/JourneyMap";
import { JourneyStats } from "../components/JourneyStats";
import { PlacePanel } from "../components/PlacePanel";
import { PlacePickerModal } from "../components/PlacePickerModal";
import { VoiceButton } from "../components/VoiceButton";
import { TelemetryPanel } from "../components/TelemetryPanel";
import { presentSafetyState } from "../constants/safety";
import {
  colors,
  fontSize,
  fontWeight,
  radius,
  space,
  touchTarget,
} from "../constants/theme";
import type { JourneyMonitor } from "../hooks/useJourneyMonitor";
import { useCameraPerception } from "../hooks/useCameraPerception";
import { useVoiceControl } from "../hooks/useVoiceControl";

type Props = {
  monitor: JourneyMonitor;
};

/**
 * The active journey.
 *
 * AURA_DESIGN.md section 09: the map dominates while the journey is normal, and
 * the detail below it stays short. Anything the traveller does not need at a
 * glance sits behind "Details" rather than crowding the screen.
 */
export function JourneyScreen({ monitor }: Props) {
  const {
    journey,
    safetyState,
    telemetry,
    lastReading,
    trail,
    plannedRoute,
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
  const presentation = presentSafetyState(safetyState);
  const headline = place.paused ? `At ${place.current}` : presentation.headline;
  const statusColor = place.paused ? colors.statusSafe : presentation.color;

  // "Where am I?" — one sentence, per AURA_DESIGN.md section 31.
  const describeLocation = () => {
    if (place.current) return `You're at ${place.current}.`;
    const destinationName = destination ?? "your destination";
    if (!telemetry) return `You're on your way to ${destinationName}.`;
    if (telemetry.deviationMeters >= 50) {
      return `You're about ${Math.round(telemetry.deviationMeters)} metres off your route to ${destinationName}.`;
    }
    return `You're on route to ${destinationName}.`;
  };

  const voice = useVoiceControl({
    onSafe: () => respond("SAFE"),
    onHelp: () => respond("HELP"),
    onStop: () => void stop(),
    describeLocation,
  });

  // The camera is the last leg of the perception chain: frames go to the edge
  // node, the node's events reach the console over SSE, and what it finds on
  // the ground is spoken here. Speed and safety state are passed through as
  // readings — the node decides the sampling rate and what the hazard is.
  const perception = useCameraPerception({
    journeyId: journey?.id ?? null,
    speedMps: lastReading?.speed_mps ?? 0,
    safetyState,
    // A full-screen safety check is not the moment to be told about pavement.
    enabled: safetyState !== "CHECKING",
  });

  const mapLatitude = lastReading?.latitude ?? journey?.origin.latitude ?? 13.0827;
  const mapLongitude = lastReading?.longitude ?? journey?.origin.longitude ?? 80.2707;

  return (
    <View style={styles.screen}>
      {/* Status strip — the one thing that must be readable at a glance. */}
      <View style={styles.statusBar}>
        <View style={styles.statusText}>
          <Text
            accessibilityRole="header"
            style={[styles.headline, { color: statusColor }]}
            numberOfLines={2}
          >
            {presentation.marker} {headline}
          </Text>
          {destination ? (
            <Text style={styles.destination} numberOfLines={1}>
              To {destination}
            </Text>
          ) : null}
        </View>
        {!online ? (
          <ConnectionBadge online={online} queuedReadings={queuedReadings} />
        ) : null}

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
          style={[styles.endButton, confirmEnd && styles.endButtonConfirm]}
        >
          <Text style={[styles.endLabel, confirmEnd && styles.endLabelConfirm]}>
            {confirmEnd ? "Tap to confirm" : "End"}
          </Text>
        </Pressable>
      </View>

      <JourneyMap
        plannedRoute={plannedRoute}
        trail={trail}
        latitude={lastReading?.latitude ?? null}
        longitude={lastReading?.longitude ?? null}
        heading={lastReading?.heading ?? 0}
        safetyState={safetyState}
        places={place.saved}
      />

      <View style={styles.sheet}>
        {error ? (
          <View accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <JourneyStats fix={fix} accuracyMeters={lastReading?.accuracy ?? null} />

        <JourneyCamera perception={perception} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showDetails ? "Hide journey details" : "Show journey details"}
          accessibilityState={{ expanded: showDetails }}
          onPress={() => setShowDetails((open) => !open)}
          style={styles.detailsToggle}
        >
          <Text style={styles.detailsLabel} numberOfLines={1}>
            {place.paused
              ? `At ${place.current} — checks paused`
              : telemetry
                ? summarise(telemetry.deviationMeters, telemetry.inactivitySeconds)
                : "Following your route"}
          </Text>
          <Text style={styles.detailsChevron}>{showDetails ? "Hide" : "Details"}</Text>
        </Pressable>

        {isPanicGestureSupported ? (
          <Text style={styles.panicHint}>{PANIC_GESTURE_HINT}</Text>
        ) : null}

        {showDetails ? (
          <ScrollView style={styles.details} keyboardShouldPersistTaps="handled">
            <View style={styles.detailsInner}>
              {/* Actionable first; telemetry is reference material. */}
              <PlacePanel
                place={place}
                canSave={lastReading !== null}
                onSave={(label, radiusMeters) => void savePlace(label, undefined, radiusMeters)}
                onPickOnMap={(label) => setPickingLabel(label)}
              />
              <TelemetryPanel
                telemetry={telemetry}
                etaSeconds={journey?.route.eta_seconds ?? null}
                distanceMeters={journey?.route.distance_meters ?? null}
              />
            </View>
          </ScrollView>
        ) : null}

        {/* Held, not tapped: this notifies a trusted contact and opens an
            incident, and there is no quiet undo. */}
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

/** One short line, per AURA_DESIGN.md section 26: "420 m off route" beats a chart. */
function summarise(deviationMeters: number, inactivitySeconds: number): string {
  if (deviationMeters >= 50) return `${Math.round(deviationMeters)} m off route`;
  if (inactivitySeconds >= 60) {
    const minutes = Math.round(inactivitySeconds / 60);
    return `Stopped for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return "On your way";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statusBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.compact,
    paddingHorizontal: space.default,
    paddingBottom: space.tight,
    paddingTop: space.micro,
  },
  statusText: {
    flex: 1,
  },
  headline: {
    fontSize: fontSize.section,
    fontWeight: fontWeight.semibold,
    // "Your trusted contact has been notified." must never be truncated.
    lineHeight: 27,
  },
  destination: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
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
    color: colors.statusAttention,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: space.compact,
    paddingHorizontal: space.default,
    paddingTop: space.default,
    paddingBottom: space.default,
  },
  detailsToggle: {
    alignItems: "center",
    flexDirection: "row",
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
    // silent SOS, and #8A8A84 on the sheet is 3.5:1 — below AA for body text.
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    textAlign: "center",
  },
  detailsChevron: {
    color: colors.statusInfo,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  details: {
    // Enough room for the expanded place editor without burying the map.
    // The map is flex:1, so it simply gives up the space while this is open.
    maxHeight: Math.round(Dimensions.get("window").height * 0.42),
  },
  detailsInner: {
    gap: space.compact,
    paddingBottom: space.tight,
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
