import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
import type { Telemetry } from "../hooks/useJourneyMonitor";

type Props = {
  telemetry: Telemetry | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
};

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} sec`;
  const minutes = Math.round(total / 60);
  return `${minutes} min`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDrift(seconds: number): string {
  if (seconds === 0) return "on time";
  const label = formatDuration(Math.abs(seconds));
  return seconds > 0 ? `${label} behind` : `${label} ahead`;
}

/**
 * Journey facts, kept deliberately small. AURA_DESIGN.md rule 5: do not
 * overload the screen with telemetry.
 */
export function TelemetryPanel({ telemetry, etaSeconds, distanceMeters }: Props) {
  const rows: { label: string; value: string }[] = [];

  if (etaSeconds != null && distanceMeters != null) {
    rows.push({
      label: "Planned",
      value: `${formatDuration(etaSeconds)} · ${formatDistance(distanceMeters)}`,
    });
  }

  if (telemetry) {
    rows.push({
      label: "Off route",
      value: formatDistance(telemetry.deviationMeters),
    });
    rows.push({
      label: "Stopped for",
      value:
        telemetry.inactivitySeconds > 0
          ? formatDuration(telemetry.inactivitySeconds)
          : "moving",
    });
    rows.push({ label: "Arrival", value: formatDrift(telemetry.etaDeltaSeconds) });
  }

  if (rows.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.waiting}>Waiting for your first GPS fix…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.default,
    paddingVertical: space.tight,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.compact,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  value: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  waiting: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    paddingVertical: space.compact,
  },
});
