import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import { prepareAlarm, startAlarm, stopAlarm } from "../services/alarm";
import {
  activatedFeedback,
  cancelledFeedback,
  holdTickFeedback,
  tapFeedback,
} from "../services/haptics";
import { speakUrgent, stopSpeaking } from "../services/speech";

type Props = {
  label: string;
  holdingLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onActivate: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/** Five seconds, escalating each one. Only the last second calls for help. */
const HOLD_SECONDS = 5;
const HOLD_MS = HOLD_SECONDS * 1000;

/** Gap between the four beats of second two. */
const BEAT_GAP_MS = 110;

/** Repeating buzz from second three: [wait, vibrate, pause]. */
const CONTINUOUS_PATTERN = [0, 500, 120];

/**
 * An action that has to be meant, and that announces itself as it builds.
 *
 * Raising an SOS notifies a trusted contact and opens an incident — there is no
 * quiet undo. The hold escalates so the traveller knows exactly how far along
 * it is without looking:
 *
 *   1s  one beat            — you are holding something
 *   2s  four rapid beats    — this is going somewhere
 *   3s  continuous + alarm  — audible to anyone nearby
 *   4s  continuous + alarm
 *   5s  emergency raised
 *
 * Releasing at any point before five seconds stops everything and calls for
 * nothing.
 */
export function HoldButton({
  label,
  holdingLabel = "Keep holding",
  disabled = false,
  busy = false,
  onActivate,
  accessibilityHint,
  style,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);

  // Decoding the tone at the third second would delay the alarm, so load early.
  useEffect(() => {
    prepareAlarm();
  }, []);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    Vibration.cancel();
    void stopAlarm();
  }, []);

  useEffect(() => clearAll, [clearAll]);

  const at = useCallback((ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms));
  }, []);

  const reset = useCallback(() => {
    clearAll();
    setHolding(false);
    setElapsed(0);
    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [clearAll, progress]);

  const start = useCallback(() => {
    if (disabled || busy) return;

    setHolding(true);
    setElapsed(0);
    tapFeedback();
    speakUrgent(`Hold ${HOLD_SECONDS} seconds to call for help.`);

    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Second 1 — a single beat.
    at(1000, () => {
      setElapsed(1);
      holdTickFeedback();
      Vibration.vibrate(45);
    });

    // Second 2 — four in quick succession.
    at(2000, () => {
      setElapsed(2);
      for (let i = 0; i < 4; i += 1) {
        at(i * BEAT_GAP_MS, () => {
          holdTickFeedback();
          Vibration.vibrate(35);
        });
      }
    });

    // Second 3 — continuous, and now audible.
    at(3000, () => {
      setElapsed(3);
      stopSpeaking();
      Vibration.vibrate(CONTINUOUS_PATTERN, true);
      void startAlarm();
    });

    at(4000, () => setElapsed(4));

    // Second 5 — only now is it an emergency.
    at(HOLD_MS, () => {
      clearAll();
      setHolding(false);
      setElapsed(0);
      activatedFeedback();
      onActivate();
      progress.setValue(0);
    });
  }, [at, busy, clearAll, disabled, onActivate, progress]);

  const cancel = useCallback(() => {
    if (!holding) return;
    stopSpeaking();
    cancelledFeedback();
    speakUrgent("Cancelled. No one was called.");
    reset();
  }, [holding, reset]);

  const fillWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  const inactive = disabled || busy;
  const remaining = Math.max(0, HOLD_SECONDS - elapsed);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        accessibilityHint ?? `Press and hold for ${HOLD_SECONDS} seconds.`
      }
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPressIn={start}
      onPressOut={cancel}
      style={[
        styles.base,
        holding && elapsed >= 3 && styles.alarming,
        inactive && styles.inactive,
        style,
      ]}
    >
      <Animated.View style={[styles.fill, { width: fillWidth }]} />

      <View style={styles.content}>
        <Text style={styles.label}>
          {holding ? `${holdingLabel} · ${remaining}` : label}
        </Text>
        <Text style={styles.hint}>
          {holding ? "Release to cancel" : `Hold ${HOLD_SECONDS}s`}
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
    // The one control someone may have to hit without looking, in the dark,
    // while frightened. CLAUDE.md reserves 96 for exactly this.
    minHeight: touchTarget.safetyAction,
    overflow: "hidden",
    paddingHorizontal: space.section,
    paddingVertical: space.compact,
  },
  /** From the third second the control itself reads as an alarm. */
  alarming: {
    backgroundColor: "#8C1A12",
    borderColor: "#8C1A12",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    right: undefined,
    backgroundColor: "rgba(0,0,0,0.3)",
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
