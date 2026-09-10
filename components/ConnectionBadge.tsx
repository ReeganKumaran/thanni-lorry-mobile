import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";

type Props = {
  online: boolean;
  queuedReadings: number;
};

/**
 * Whether the phone is actually reaching the backend. A monitoring product that
 * has quietly stopped reporting is worse than one that says so.
 */
export function ConnectionBadge({ online, queuedReadings }: Props) {
  const label = online
    ? "Reporting to AURA"
    : queuedReadings > 0
      ? `Offline · ${queuedReadings} update${queuedReadings === 1 ? "" : "s"} held`
      : "Offline";
  const color = online ? colors.statusSafe : colors.statusAttention;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={styles.container}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.tight,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingHorizontal: space.compact,
    paddingVertical: space.tight,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
});
