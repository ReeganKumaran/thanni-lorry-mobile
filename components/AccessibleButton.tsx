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
  safe: "#FFFFFF",
  risk: "#FFFFFF",
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
          backgroundColor: FILL[variant],
          borderColor: variant === "secondary" ? colors.border : FILL[variant],
        },
        pressed && styles.pressed,
        inactive && styles.inactive,
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
                { color: LABEL_COLOR[variant] },
              ]}
            >
              {label}
            </Text>
            {hint ? (
              <Text style={[styles.hint, { color: LABEL_COLOR[variant] }]}>{hint}</Text>
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
  inactive: {
    opacity: 0.45,
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
