import { StyleSheet, View } from "react-native";

import { colors } from "../constants/theme";

type Props = {
  size?: number;
  color?: string;
};

/**
 * The familiar crosshair: a ring with a centre dot and four ticks.
 *
 * Composed from plain Views rather than a glyph or an SVG. The `◎` character
 * this replaces rendered differently on every font, and pulling in a vector
 * icon library would mean a native dependency and a rebuild for one small mark.
 */
export function MyLocationIcon({ size = 22, color = colors.text }: Props) {
  const ringSize = size * 0.64;
  const dotSize = size * 0.27;
  const tickLength = size * 0.2;
  const tickThickness = Math.max(1.5, size * 0.09);

  const horizontalTick = {
    width: tickLength,
    height: tickThickness,
    borderRadius: tickThickness / 2,
    backgroundColor: color,
  };
  const verticalTick = {
    width: tickThickness,
    height: tickLength,
    borderRadius: tickThickness / 2,
    backgroundColor: color,
  };

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderColor: color,
            borderWidth: tickThickness,
          },
        ]}
      >
        <View
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
          }}
        />
      </View>

      <View style={[styles.tick, styles.tickTop, verticalTick]} />
      <View style={[styles.tick, styles.tickBottom, verticalTick]} />
      <View style={[styles.tick, styles.tickLeft, horizontalTick]} />
      <View style={[styles.tick, styles.tickRight, horizontalTick]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
  },
  tickTop: { top: 0 },
  tickBottom: { bottom: 0 },
  tickLeft: { left: 0 },
  tickRight: { right: 0 },
});
