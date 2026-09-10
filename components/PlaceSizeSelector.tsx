import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import { PLACE_SIZES } from "../types/api";
import type { PlaceSizeKey } from "../types/api";

type Props = {
  value: PlaceSizeKey;
  onChange: (value: PlaceSizeKey) => void;
  disabled?: boolean;
};

/** How much ground a saved place should cover. */
export function PlaceSizeSelector({ value, onChange, disabled = false }: Props) {
  const selected = PLACE_SIZES.find((s) => s.key === value) ?? PLACE_SIZES[0];

  return (
    <View style={styles.container}>
      <View accessibilityRole="radiogroup" style={styles.row}>
        {PLACE_SIZES.map((size) => {
          const active = size.key === value;
          return (
            <Pressable
              key={size.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`${size.label}, ${size.meters} metres, ${size.hint}`}
              disabled={disabled}
              onPress={() => onChange(size.key)}
              style={[styles.option, active && styles.optionActive]}
            >
              <Text style={[styles.label, active && styles.labelActive]}>
                {size.label}
              </Text>
              <Text style={[styles.meters, active && styles.metersActive]}>
                {size.meters >= 1000 ? `${size.meters / 1000} km` : `${size.meters} m`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{selected.hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.micro,
  },
  row: {
    flexDirection: "row",
    gap: space.tight,
  },
  option: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: touchTarget.min,
    paddingVertical: space.tight,
  },
  optionActive: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.text,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  labelActive: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  meters: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
  metersActive: {
    color: colors.textSecondary,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
});
