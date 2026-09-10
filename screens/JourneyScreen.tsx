import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AccessibleButton } from "../components/AccessibleButton";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { PlacePanel } from "../components/PlacePanel";
import { PlacePickerModal } from "../components/PlacePickerModal";
import { SafetyStatusBanner } from "../components/SafetyStatusBanner";
import { TelemetryPanel } from "../components/TelemetryPanel";
import { colors, fontSize, space } from "../constants/theme";
import type { JourneyMonitor } from "../hooks/useJourneyMonitor";

type Props = {
  monitor: JourneyMonitor;
};

/**
 * The active journey view. A map belongs here (AURA_DESIGN.md section 09); this
 * first version shows the same journey facts in text until the map layer lands.
 */
export function JourneyScreen({ monitor }: Props) {
  const {
    journey,
    safetyState,
    telemetry,
    lastReading,
    online,
    queuedReadings,
    respondingToCheck,
    error,
    respond,
    stop,
    place,
    savePlace,
  } = monitor;

  const destination = journey?.destination.name ?? null;

  // Which place the OpenStreetMap picker is currently setting, if any.
  const [pickingLabel, setPickingLabel] = useState<string | null>(null);

  // Open the map on the last GPS fix, or the journey origin before one arrives.
  const mapLatitude = lastReading?.latitude ?? journey?.origin.latitude ?? 13.0827;
  const mapLongitude = lastReading?.longitude ?? journey?.origin.longitude ?? 80.2707;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ConnectionBadge online={online} queuedReadings={queuedReadings} />

      <SafetyStatusBanner
        state={safetyState}
        destination={destination}
        pausedAt={place.paused ? place.current : null}
      />

      <PlacePanel
        place={place}
        canSave={lastReading !== null}
        onSave={(label) => void savePlace(label)}
        onPickOnMap={(label) => setPickingLabel(label)}
      />

      <PlacePickerModal
        visible={pickingLabel !== null}
        label={pickingLabel ?? ""}
        initialLatitude={mapLatitude}
        initialLongitude={mapLongitude}
        busy={place.saving}
        onCancel={() => setPickingLabel(null)}
        onConfirm={(latitude, longitude) => {
          const label = pickingLabel;
          setPickingLabel(null);
          if (label) void savePlace(label, { latitude, longitude });
        }}
      />

      <TelemetryPanel
        telemetry={telemetry}
        etaSeconds={journey?.route.eta_seconds ?? null}
        distanceMeters={journey?.route.distance_meters ?? null}
      />

      {lastReading ? (
        <Text style={styles.fix}>
          Last fix {lastReading.latitude.toFixed(5)}, {lastReading.longitude.toFixed(5)} ·
          ±{Math.round(lastReading.accuracy)} m
        </Text>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <AccessibleButton
          label="I need help"
          variant="risk"
          size="safety"
          busy={respondingToCheck}
          onPress={() => respond("HELP")}
          accessibilityHint="Notifies your trusted contact immediately."
        />
        <AccessibleButton
          label="End journey"
          variant="secondary"
          onPress={() => void stop()}
          accessibilityHint="Stops sharing your location with AURA."
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space.section,
    gap: space.default,
    paddingBottom: space.large,
  },
  fix: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
  error: {
    backgroundColor: colors.surface,
    borderColor: colors.statusRisk,
    borderRadius: 12,
    borderWidth: 1,
    padding: space.default,
  },
  errorText: {
    color: colors.statusRisk,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  actions: {
    gap: space.compact,
    paddingTop: space.tight,
  },
});
