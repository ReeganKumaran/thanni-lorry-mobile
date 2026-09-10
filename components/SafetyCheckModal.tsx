import { useEffect, useRef, useState } from "react";
import { Modal, StyleSheet, Text, Vibration, View } from "react-native";

import { AccessibleButton } from "./AccessibleButton";
import { colors, fontSize, fontWeight, space } from "../constants/theme";
import { speakUrgent, stopSpeaking } from "../services/speech";
import type { CheckinResponse, PendingSafetyCheck } from "../types/api";

type Props = {
  visible: boolean;
  check: PendingSafetyCheck | null;
  busy: boolean;
  onRespond: (response: CheckinResponse) => void;
};

/** Re-pulse until answered — this prompt must be impossible to miss. */
const PULSE_INTERVAL_MS = 4000;
const PULSE_PATTERN = [0, 500, 250, 500];

/** Spoken reminder once the window is nearly out. */
const SPOKEN_WARNING_AT_SECONDS = 10;

function remainingSeconds(check: PendingSafetyCheck | null): number | null {
  if (!check) return null;
  const sentAt = Date.parse(check.sentAt);
  if (Number.isNaN(sentAt)) return check.timeoutSeconds;
  const elapsed = (Date.now() - sentAt) / 1000;
  return Math.max(0, Math.round(check.timeoutSeconds - elapsed));
}

/**
 * The most important interaction in the product (AURA_DESIGN.md section 12):
 * a focused takeover, two actions, no third option, and a plain-language reason.
 */
export function SafetyCheckModal({ visible, check, busy, onRespond }: Props) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      Vibration.cancel();
      warnedRef.current = false;
      setSecondsLeft(null);
      return;
    }

    Vibration.vibrate(PULSE_PATTERN);
    const pulse = setInterval(() => Vibration.vibrate(PULSE_PATTERN), PULSE_INTERVAL_MS);

    const tick = () => {
      const left = remainingSeconds(check);
      setSecondsLeft(left);
      if (left !== null && left <= SPOKEN_WARNING_AT_SECONDS && !warnedRef.current) {
        warnedRef.current = true;
        speakUrgent("Still there? Answer so I don't alert your contact.");
      }
    };

    tick();
    const countdown = setInterval(tick, 1000);

    return () => {
      clearInterval(pulse);
      clearInterval(countdown);
      Vibration.cancel();
    };
  }, [visible, check]);

  const respond = (response: CheckinResponse) => {
    Vibration.cancel();
    stopSpeaking();
    onRespond(response);
  };

  const reason = check?.reason?.trim();
  const prompt = check?.message?.trim() || "Are you safe?";

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={() => {
        /* The traveller has to answer; back must not dismiss this. */
      }}
    >
      <View style={styles.screen}>
        <View style={styles.prompt}>
          <Text accessibilityRole="header" style={styles.question}>
            Are you safe?
          </Text>

          <Text style={styles.reason}>{reason || prompt}</Text>

          {secondsLeft !== null ? (
            <Text
              accessibilityLabel={`${secondsLeft} seconds to answer before your trusted contact is notified`}
              style={styles.countdown}
            >
              {secondsLeft}s to answer
            </Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <AccessibleButton
            label="I'm safe"
            variant="safe"
            size="safety"
            busy={busy}
            onPress={() => respond("SAFE")}
            accessibilityHint="Tells AURA you are fine and continues monitoring."
          />
          <AccessibleButton
            label="I need help"
            variant="risk"
            size="safety"
            disabled={busy}
            onPress={() => respond("HELP")}
            accessibilityHint="Notifies your trusted contact immediately."
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: space.section,
    paddingTop: space.page,
    paddingBottom: space.large,
    justifyContent: "space-between",
  },
  prompt: {
    gap: space.default,
    paddingTop: space.large,
  },
  question: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: fontWeight.semibold,
    lineHeight: 54,
  },
  reason: {
    color: colors.textSecondary,
    fontSize: fontSize.section,
    lineHeight: 30,
  },
  countdown: {
    color: colors.statusAttention,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.medium,
  },
  actions: {
    gap: space.default,
  },
});
