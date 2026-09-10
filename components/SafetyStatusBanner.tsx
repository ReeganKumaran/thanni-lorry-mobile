import { StyleSheet, Text, View } from "react-native";

import { presentSafetyState } from "../constants/safety";
import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
import type { SafetyState } from "../types/api";

type Props = {
  state: SafetyState;
  destination?: string | null;
};

/**
 * The one place the traveller looks to know where they stand. Status is carried
 * by text and a shape marker as well as colour (AURA_DESIGN.md section 30).
 */
export function SafetyStatusBanner({ state, destination }: Props) {
  const { headline, detail, color, marker } = presentSafetyState(state);

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${headline} ${detail}`}
      style={[styles.container, { borderColor: color }]}
    >
      <View style={styles.markerRow}>
        <Text style={[styles.marker, { color }]}>{marker}</Text>
        <Text style={[styles.stateLabel, { color }]}>
          {destination ? `To ${destination}` : "AURA"}
        </Text>
      </View>

      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: space.section,
    gap: space.tight,
  },
  markerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.tight,
  },
  marker: {
    fontSize: fontSize.meta,
  },
  stateLabel: {
    fontSize: fontSize.meta,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headline: {
    color: colors.text,
    fontSize: fontSize.pageTitle,
    fontWeight: fontWeight.semibold,
    lineHeight: 38,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
});
