import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import {
  activatedFeedback,
  cancelledFeedback,
  holdTickFeedback,
  tapFeedback,
} from "../services/haptics";
import { speakUrgent, stopSpeaking } from "../services/speech";

type Props = {
  label: string;
  /** Shown while the hold is in progress, e.g. "Keep holding". */
  holdingLabel?: string;
  holdMs?: number;
  disabled?: boolean;
  busy?: boolean;
  onActivate: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_HOLD_MS = 3000;

/**
 * An action that has to be meant.
 *
 * Raising an SOS notifies a trusted contact and opens an incident — there is no
 * quiet undo, so a single stray tap must not do it. Holding proves intent.
 *
 * The countdown is spoken and felt as well as drawn: this is the one control a
 * traveller may need to use without looking at the screen, so releasing early
 * says so out loud rather than just silently stopping.
 */
export function HoldButton({
  label,
  holdingLabel = "Keep holding",
  holdMs = DEFAULT_HOLD_MS,
  disabled = false,
  busy = false,
  onActivate,
  accessibilityHint,
  style,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const fireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holding, setHolding] = useState(false);
  const [remaining, setRemaining] = useState(Math.ceil(holdMs / 1000));

  const clearTimers = useCallback(() => {
    if (fireTimer.current) clearTimeout(fireTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    fireTimer.current = null;
    tickTimer.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setHolding(false);
    setRemaining(Math.ceil(holdMs / 1000));
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [clearTimers, holdMs, progress]);

  const start = useCallback(() => {
    if (disabled || busy) return;

    setHolding(true);
    tapFeedback();
    speakUrgent(`Hold for ${Math.ceil(holdMs / 1000)} seconds to call for help.`);

    Animated.timing(progress, {
      toValue: 1,
      duration: holdMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const startedAt = Date.now();
    setRemaining(Math.ceil(holdMs / 1000));
    tickTimer.current = setInterval(() => {
      const left = Math.ceil((holdMs - (Date.now() - startedAt)) / 1000);
      if (left > 0) {
        setRemaining(left);
        holdTickFeedback();
      }
    }, 1000);

    fireTimer.current = setTimeout(() => {
      clearTimers();
      setHolding(false);
      // A notification burst, distinct from every tick that preceded it, so
      // activation is unmistakable without looking at the screen.
      activatedFeedback();
      stopSpeaking();
      onActivate();
      progress.setValue(0);
    }, holdMs);
  }, [busy, clearTimers, disabled, holdMs, onActivate, progress]);

  const cancel = useCallback(() => {
    if (!holding) return;
    stopSpeaking();
    cancelledFeedback();
    speakUrgent("Cancelled.");
    reset();
  }, [holding, reset]);

  const fillWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        accessibilityHint ?? `Press and hold for ${Math.ceil(holdMs / 1000)} seconds.`
      }
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPressIn={start}
      onPressOut={cancel}
      style={[styles.base, inactive && styles.inactive, style]}
    >
      {/* Fills left to right as the hold progresses. */}
      <Animated.View style={[styles.fill, { width: fillWidth }]} />

      <View style={styles.content}>
        <Text style={styles.label}>
          {holding ? `${holdingLabel} · ${remaining}` : label}
        </Text>
        <Text style={styles.hint}>
          {holding ? "Release to cancel" : `Hold ${Math.ceil(holdMs / 1000)}s`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.statusRisk,
    borderColor: colors.statusRisk,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.comfortable,
    overflow: "hidden",
    paddingHorizontal: space.section,
    paddingVertical: space.compact,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    right: undefined,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  content: {
    alignItems: "center",
    gap: 2,
  },
  label: {
    color: "#FFFFFF",
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.2,
  },
  hint: {
    color: "#FFFFFF",
    fontSize: fontSize.meta,
    opacity: 0.85,
  },
  inactive: {
    opacity: 0.45,
  },
});
