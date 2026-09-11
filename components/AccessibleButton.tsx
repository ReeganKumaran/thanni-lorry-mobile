import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";

export type ButtonVariant = "primary" | "secondary" | "safe" | "risk";

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Second line of smaller text, e.g. a spoken alternative. */
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  /** Safety actions get a much taller target than the 44px minimum. */
  size?: "regular" | "safety";
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

const FILL: Record<ButtonVariant, string> = {
  primary: colors.actionPrimary,
  secondary: colors.surface,
  safe: colors.statusSafe,
  risk: colors.statusRisk,
};

const LABEL_COLOR: Record<ButtonVariant, string> = {
  primary: colors.onActionPrimary,
  secondary: colors.text,
  safe: colors.onActionPrimary,
  risk: colors.onActionPrimary,
};

export function AccessibleButton({
  label,
  onPress,
  variant = "primary",
  hint,
  disabled = false,
  busy = false,
  size = "regular",
  accessibilityHint,
  style,
}: Props) {
  const inactive = disabled || busy;
  /**
   * Disabled and busy are not the same thing and stop looking the same here.
   *
   * Both used to take `opacity: 0.45`, which put the white label on "I need
   * help" at roughly 2:1 while the request was in flight — unreadable, on the
   * control whose state a frightened traveller most needs to be sure of. Busy
   * now keeps its fill at full strength behind the spinner, and only a genuinely
   * disabled button is muted: a real surface with a real border and a label at
   * 5.06:1, rather than a ghost of itself.
   */
  const muted = disabled && !busy;
  const minHeight =
    size === "safety" ? touchTarget.safetyAction : touchTarget.comfortable;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight,
          backgroundColor: muted ? colors.surfaceMuted : FILL[variant],
          borderColor: muted
            ? colors.border
            : variant === "secondary"
              ? colors.border
              : FILL[variant],
        },
        // A filled button dims; a white one has to change ground, because 15%
        // off white is not a visible change (rule 4's 1px-border language is
        // the same idea — state shows as a real difference, not a haze).
        pressed && (variant === "secondary" ? styles.pressedSecondary : styles.pressed),
        style,
      ]}
    >
      <View style={styles.content}>
        {busy ? (
          <ActivityIndicator color={LABEL_COLOR[variant]} />
        ) : (
          <>
            <Text
              style={[
                styles.label,
                size === "safety" && styles.labelSafety,
                { color: muted ? colors.textSecondary : LABEL_COLOR[variant] },
              ]}
            >
              {label}
            </Text>
            {hint ? (
              <Text
                style={[
                  styles.hint,
                  { color: muted ? colors.textSecondary : LABEL_COLOR[variant] },
                ]}
              >
                {hint}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: space.section,
    paddingVertical: space.default,
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.micro,
  },
  pressed: {
    opacity: 0.85,
  },
  pressedSecondary: {
    backgroundColor: colors.surfaceMuted,
  },
  label: {
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  labelSafety: {
    fontSize: fontSize.section,
  },
  hint: {
    fontSize: fontSize.meta,
    fontWeight: fontWeight.regular,
    opacity: 0.8,
    textAlign: "center",
  },
});
