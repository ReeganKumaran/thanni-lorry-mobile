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
  // Hue on the dot only. On surfaceMuted statusAttention is 3.93:1 and even
  // statusSafe is 4.38:1 — both under the AA floor for a 13px label — and the
  // label already says "Offline" in words, so it keeps full contrast.
  const color = online ? colors.statusSafe : colors.statusAttention;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={styles.container}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label}>{label}</Text>
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
    color: colors.text,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
});
