import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { colors, fontSize, fontWeight, motion, space } from "../constants/theme";
import { useReducedMotion } from "../hooks/useReducedMotion";

type Props = {
  /** Route completed, 0..1. Already clamped by the backend. */
  progress: number | null;
  /** Distance still to walk, as the backend measured it against the route. */
  remainingMeters: number | null;
  /** Planned duration for the whole journey. */
  etaSeconds: number | null;
};

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * How much of the journey is left.
 *
 * AURA_DESIGN.md section 09 puts the destination and "12 min · 1.8 km" directly
 * under the map; until now both were buried behind "Details", so the commonest
 * question on the screen — am I nearly there? — was the one it did not answer.
 *
 * Every number here was computed by the backend and read back
 * (`remaining_meters`, clamped `progress`). The phone does not measure progress:
 * CLAUDE.md rule 2 puts route maths server-side, and rule 3 keeps the UI out of
 * deriving anything from raw readings. The bar is the same fact as the words
 * beside it, never the only copy of it (section 30).
 */
export function RouteProgress({ progress, remainingMeters, etaSeconds }: Props) {
  const reducedMotion = useReducedMotion();
  const fraction = useRef(new Animated.Value(progress ?? 0)).current;
  const target = Math.min(1, Math.max(0, progress ?? 0));

  useEffect(() => {
    if (reducedMotion) {
      fraction.setValue(target);
      return;
    }
    Animated.timing(fraction, {
      toValue: target,
      duration: motion.component,
      easing: Easing.out(Easing.cubic),
      // An animated width cannot run on the native driver, and the bar is a few
      // pixels tall — this is the cheap case, not the hot one.
      useNativeDriver: false,
    }).start();
  }, [fraction, reducedMotion, target]);

  if (progress === null && remainingMeters === null) return null;

  const facts = [
    remainingMeters !== null ? `${formatDistance(remainingMeters)} to go` : null,
    etaSeconds !== null ? `${formatDuration(etaSeconds)} planned` : null,
  ].filter((fact): fact is string => fact !== null);

  const width = fraction.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={facts.join(". ")}>
      <Text style={styles.facts} numberOfLines={1}>
        {facts.map((fact, index) => (
          <Text key={fact} style={index === 0 ? styles.lead : undefined}>
            {index > 0 ? " · " : ""}
            {fact}
          </Text>
        ))}
      </Text>

      {/* Neutral on purpose. Status colour means a safety state on this product,
          and a route being two-thirds walked is not one. */}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  facts: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    paddingBottom: space.micro,
  },
  lead: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  track: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 2,
    height: 4,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: colors.text,
    height: 4,
  },
});
