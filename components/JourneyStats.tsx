import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, fontWeight, space } from "../constants/theme";
import type { FixState } from "../hooks/useJourneyMonitor";

type Props = {
  fix: FixState;
  accuracyMeters: number | null;
};

/** Beyond this, fixes have stopped arriving and the traveller should know. */
const STALE_AFTER_SECONDS = 15;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Proof the journey is being tracked.
 *
 * AURA_DESIGN.md section 26 asks for simple primitives — a number and a label —
 * rather than charts. The live row matters most: a monitoring app that has
 * silently stopped receiving fixes looks exactly like one that is working.
 */
export function JourneyStats({ fix, accuracyMeters }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = fix.startedAt ? Math.floor((now - fix.startedAt) / 1000) : 0;
  const sinceFix = fix.lastFixAt ? Math.floor((now - fix.lastFixAt) / 1000) : null;
  const stale = sinceFix !== null && sinceFix > STALE_AFTER_SECONDS;

  const liveLabel =
    sinceFix === null
      ? "Waiting for the first GPS fix"
      : stale
        ? `No GPS for ${formatClock(sinceFix)}`
        : sinceFix <= 2
          ? "Live"
          : `Updated ${sinceFix}s ago`;

  const liveColor = sinceFix === null || stale ? colors.statusAttention : colors.statusSafe;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Stat label="Elapsed" value={formatClock(elapsed)} />
        <Stat label="Walked" value={formatDistance(fix.distanceMeters)} />
        <Stat
          label="GPS"
          value={accuracyMeters != null ? `±${Math.round(accuracyMeters)} m` : "—"}
        />
      </View>

      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${liveLabel}. ${fix.count} location updates sent.`}
        style={styles.liveRow}
      >
        <View style={[styles.dot, { backgroundColor: liveColor }]} />
        <Text style={[styles.liveLabel, { color: liveColor }]}>{liveLabel}</Text>
        <Text style={styles.count}>
          {fix.count} update{fix.count === 1 ? "" : "s"}
        </Text>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label} ${value}`} style={styles.stat}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.tight,
  },
  row: {
    flexDirection: "row",
  },
  stat: {
    flex: 1,
  },
  value: {
    color: colors.text,
    fontSize: fontSize.section,
    fontWeight: fontWeight.semibold,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
  liveRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveLabel: {
    flex: 1,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  count: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
});
