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

/** How long the SOS must be held. Everything below is derived from it. */
const HOLD_SECONDS = 10;
const HOLD_MS = HOLD_SECONDS * 1000;

/**
 * The escalation is expressed as fractions of the hold, never as absolute
 * seconds.
 *
 * The ladder used to be hardcoded at 1s, 2s, 3s, 4s against a 5s hold. Raising
 * the hold to 10s under those numbers would have left everything after the
 * fourth second silent — six seconds of nothing on an emergency control, which
 * to someone who cannot see the screen is indistinguishable from a control that
 * has stopped working. Scaling the phases means the hold length can change
 * again without ever opening that gap.
 */
const FLURRY_FROM = 0.4;
const CONTINUOUS_FROM = 0.6;

/** Gap between the beats of the flurry phase. */
const BEAT_GAP_MS = 110;

/** Repeating buzz once the hold turns continuous: [wait, vibrate, pause]. */
const CONTINUOUS_PATTERN = [0, 500, 120];

/** True once the hold has escalated to the continuous, audible phase. */
function isContinuous(elapsedSeconds: number): boolean {
  return elapsedSeconds / HOLD_SECONDS >= CONTINUOUS_FROM;
}

/** Spoken and screen-reader description, built from the real timings. */
export const HOLD_TIMING_HINT =
  `Press and hold for ${HOLD_SECONDS} seconds. ` +
  `An alarm sounds from ${Math.round(CONTINUOUS_FROM * HOLD_SECONDS)} seconds.`;

/**
 * An action that has to be meant, and that announces itself as it builds.
 *
 * Raising an SOS notifies a trusted contact and opens an incident — there is no
 * quiet undo. The hold escalates so the traveller knows exactly how far along
 * it is without looking:
 *
 *   every second        a beat, so there is never silence while holding
 *   from 40%           the beat becomes a flurry — this is going somewhere
 *   from 60%           continuous buzz and an alarm, audible to anyone nearby
 *   at 100%            emergency raised
 *
 * Releasing at any point before the end stops everything and calls for nothing.
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

    // One beat on every second of the hold, whatever the hold length. The
    // countdown on the button counts down in step with it.
    for (let second = 1; second < HOLD_SECONDS; second += 1) {
      at(second * 1000, () => {
        setElapsed(second);
        const progressed = second / HOLD_SECONDS;

        // Once the continuous buzz is running it is the feedback; adding
        // discrete taps on top of it just muddies what stage you are at.
        if (progressed >= CONTINUOUS_FROM) return;

        if (progressed >= FLURRY_FROM) {
          for (let i = 0; i < 4; i += 1) {
            at(i * BEAT_GAP_MS, () => {
              holdTickFeedback();
              Vibration.vibrate(35);
            });
          }
        } else {
          holdTickFeedback();
          Vibration.vibrate(45);
        }
      });
    }

    // Continuous, and now audible to anyone nearby.
    at(Math.round(CONTINUOUS_FROM * HOLD_MS), () => {
      stopSpeaking();
      Vibration.vibrate(CONTINUOUS_PATTERN, true);
      void startAlarm();
    });

    // Only now is it an emergency.
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
      // The caller supplies the consequence; the timings come from here, so
      // the numbers a screen reader announces cannot drift from the ladder.
      accessibilityHint={
        accessibilityHint ? `${accessibilityHint} ${HOLD_TIMING_HINT}` : HOLD_TIMING_HINT
      }
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPressIn={start}
      onPressOut={cancel}
      style={[
        styles.base,
        holding && isContinuous(elapsed) && styles.alarming,
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
