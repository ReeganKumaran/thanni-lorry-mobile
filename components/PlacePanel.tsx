import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AccessibleButton } from "./AccessibleButton";
import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import { DEFAULT_PLACE_SIZE, PLACE_LABELS, metersForSize } from "../types/api";
import type { KnownPlace, PlaceSizeKey } from "../types/api";
import { PlaceSizeSelector } from "./PlaceSizeSelector";

/** Show what a saved place currently covers, so a resize is an informed choice. */
function describeRadius(saved: KnownPlace[], label: string): string {
  const match = saved.find((p) => p.label.toLowerCase() === label.toLowerCase());
  if (!match) return "";
  const m = match.radius_meters;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
import type { PlaceState } from "../hooks/useJourneyMonitor";

type Props = {
  place: PlaceState;
  canSave: boolean;
  /** Save the traveller's current position under this label, at this radius. */
  onSave: (label: string, radiusMeters: number) => void;
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
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<PlaceSizeKey>(DEFAULT_PLACE_SIZE);

  // Standing inside a place is exactly when its radius feels wrong, so this
  // stays editable rather than being a dead end.
  if (place.current && !expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`At ${place.current}. Safety checks are paused here. Tap to resize.`}
        onPress={() => setExpanded(true)}
        style={[styles.container, styles.atPlace]}
      >
        <View style={styles.atPlaceHeader}>
          <Text style={styles.atPlaceTitle}>At {place.current}</Text>
          <Text style={styles.collapsedAction}>Resize</Text>
        </View>
        <Text style={styles.atPlaceDetail}>
          AURA won&apos;t check in while you&apos;re here. Still watching for an SOS.
        </Text>
      </Pressable>
    );
  }

  const savedLabels = new Set(place.saved.map((p) => p.label.toLowerCase()));
  const allSaved = PLACE_LABELS.every((l) => savedLabels.has(l.toLowerCase()));

  // Nothing left to prompt for: collapse to a line that can be reopened.
  if (allSaved && !expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Saved places: ${place.saved
          .map((p) => p.label)
          .join(", ")}. Tap to change.`}
        onPress={() => setExpanded(true)}
        style={[styles.container, styles.collapsed]}
      >
        <Text style={styles.collapsedText} numberOfLines={1}>
          {place.saved.map((p) => p.label).join(" · ")} saved
        </Text>
        <Text style={styles.collapsedAction}>Change</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Somewhere you stop often?</Text>
      <Text style={styles.detail}>
        Save it and AURA stops asking whether you&apos;re safe while you&apos;re there.
      </Text>

      <PlaceSizeSelector value={size} onChange={setSize} disabled={place.saving} />

      {PLACE_LABELS.map((label) => {
        const saved = savedLabels.has(label.toLowerCase());
        return (
          <View key={label} style={styles.row}>
            <View style={styles.rowLabel}>
              <Text style={styles.rowName} numberOfLines={1}>
                {label}
              </Text>
              {saved ? (
                <Text style={styles.rowRadius} numberOfLines={1}>
                  {describeRadius(place.saved, label)}
                </Text>
              ) : null}
            </View>
            <AccessibleButton
              label="Use here"
              variant="secondary"
              busy={place.saving}
              disabled={!canSave}
              onPress={() => onSave(label, metersForSize(size))}
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

      {expanded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done editing places"
          onPress={() => setExpanded(false)}
          style={styles.done}
        >
          <Text style={styles.collapsedAction}>Done</Text>
        </Pressable>
      ) : null}

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
  atPlaceHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  collapsed: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
    minHeight: touchTarget.min,
    paddingVertical: space.compact,
  },
  collapsedText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.meta,
  },
  collapsedAction: {
    color: colors.statusInfo,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
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
    width: 72,
  },
  rowName: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  rowRadius: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
  button: {
    flex: 1,
    // Tight, so "Use here" stays on one line beside the label column.
    paddingHorizontal: space.micro,
  },
  done: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: touchTarget.min,
  },
  waiting: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
});
