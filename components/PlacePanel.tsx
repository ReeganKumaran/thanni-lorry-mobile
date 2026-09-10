import { StyleSheet, Text, View } from "react-native";

import { AccessibleButton } from "./AccessibleButton";
import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
import { PLACE_LABELS } from "../types/api";
import type { PlaceState } from "../hooks/useJourneyMonitor";

type Props = {
  place: PlaceState;
  canSave: boolean;
  /** Save the traveller's current position under this label. */
  onSave: (label: string) => void;
  /** Open the OpenStreetMap picker for this label. */
  onPickOnMap: (label: string) => void;
};

/**
 * Where AURA should leave you alone.
 *
 * Standing still is only worth asking about somewhere AURA has no reason to
 * expect it. Saving home, the office and college removes almost every false
 * prompt, so this sits on the journey screen rather than buried in settings.
 */
export function PlacePanel({ place, canSave, onSave, onPickOnMap }: Props) {
  if (place.current) {
    return (
      <View
        accessible
        accessibilityLabel={`At ${place.current}. Safety checks are paused here.`}
        style={[styles.container, styles.atPlace]}
      >
        <Text style={styles.atPlaceTitle}>At {place.current}</Text>
        <Text style={styles.atPlaceDetail}>
          AURA won&apos;t check in while you&apos;re here. Still watching for an SOS.
        </Text>
      </View>
    );
  }

  const savedLabels = new Set(place.saved.map((p) => p.label.toLowerCase()));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Somewhere you stop often?</Text>
      <Text style={styles.detail}>
        Save it and AURA stops asking whether you&apos;re safe while you&apos;re there.
      </Text>

      {PLACE_LABELS.map((label) => {
        const saved = savedLabels.has(label.toLowerCase());
        return (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>
              {label}
              {saved ? " ✓" : ""}
            </Text>
            <AccessibleButton
              label="Use here"
              variant="secondary"
              busy={place.saving}
              disabled={!canSave}
              onPress={() => onSave(label)}
              style={styles.button}
              accessibilityHint={`Saves where you are standing now as ${label}.`}
            />
            <AccessibleButton
              label="On map"
              variant="secondary"
              disabled={place.saving}
              onPress={() => onPickOnMap(label)}
              style={styles.button}
              accessibilityHint={`Search OpenStreetMap or drop a pin to set ${label}.`}
            />
          </View>
        );
      })}

      {!canSave ? (
        <Text style={styles.waiting}>
          Waiting for a GPS fix — you can still set a place on the map.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.tight,
    padding: space.default,
  },
  atPlace: {
    borderColor: colors.statusSafe,
  },
  atPlaceTitle: {
    color: colors.statusSafe,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
  },
  atPlaceDetail: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.medium,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 19,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
    paddingTop: space.micro,
  },
  rowLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    width: 78,
  },
  button: {
    flex: 1,
    paddingHorizontal: space.tight,
  },
  waiting: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
});
