import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";

type Props = {
  listening: boolean;
  onPress: () => void;
  /** What AURA last heard — shown for a sighted helper, spoken for everyone else. */
  lastHeard?: string | null;
  style?: StyleProp<ViewStyle>;
};

/**
 * The microphone.
 *
 * Deliberately full width and tall: someone who cannot see the screen finds a
 * control by sweeping a finger, and a small target in a corner is no target at
 * all. It sits in the same place on every screen so it can be found by memory.
 */
export function VoiceButton({ listening, onPress, lastHeard, style }: Props) {
  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listening ? "Listening. Tap to stop." : "Speak to AURA"}
        accessibilityHint="Say: I'm safe, I need help, where am I, or take me to home."
        accessibilityState={{ busy: listening }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          listening && styles.listening,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.row}>
          {listening ? (
            <ActivityIndicator color={colors.onActionPrimary} />
          ) : (
            <MicGlyph />
          )}
          <Text style={styles.label}>
            {listening ? "Listening…" : "Speak to AURA"}
          </Text>
        </View>
      </Pressable>

      {lastHeard ? (
        <Text style={styles.heard} numberOfLines={1}>
          Heard: “{lastHeard}”
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A microphone drawn from Views — a capsule, a stand and a base. Same reasoning
 * as the map crosshair: a glyph renders differently on every font, and an icon
 * library would mean a native dependency for one mark.
 */
function MicGlyph() {
  return (
    <View style={styles.mic}>
      <View style={styles.micCapsule} />
      <View style={styles.micStem} />
      <View style={styles.micBase} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.actionPrimary,
    borderColor: colors.actionPrimary,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.comfortable,
    paddingHorizontal: space.section,
    paddingVertical: space.compact,
  },
  listening: {
    backgroundColor: colors.statusInfo,
    borderColor: colors.statusInfo,
  },
  pressed: {
    opacity: 0.85,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.compact,
  },
  label: {
    color: colors.onActionPrimary,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
  },
  mic: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    width: 16,
  },
  micCapsule: {
    backgroundColor: colors.onActionPrimary,
    borderRadius: 4,
    height: 11,
    width: 8,
  },
  micStem: {
    backgroundColor: colors.onActionPrimary,
    height: 4,
    marginTop: 1,
    width: 2,
  },
  micBase: {
    backgroundColor: colors.onActionPrimary,
    borderRadius: 1,
    height: 2,
    width: 12,
  },
  heard: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    paddingTop: space.micro,
    textAlign: "center",
  },
});
