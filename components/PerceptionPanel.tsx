import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { AccessibleButton } from "./AccessibleButton";
import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
import type { PerceptionState } from "../hooks/usePerception";

type Props = {
  perception: PerceptionState;
};

/**
 * The camera side of the journey.
 *
 * The preview is deliberately small: the traveller this is built for cannot see
 * it, and AURA_DESIGN.md section 25 asks that we not paste detection output over
 * the interface. It exists so a sighted helper can confirm the camera is aimed
 * somewhere useful, and so the frames being sent are not invisible.
 *
 * What matters is spoken — section 10: "Vehicle approaching from your right",
 * never a list of detected classes.
 */
export const PerceptionPanel = forwardRef<CameraView, Props>(
  function PerceptionPanel({ perception }, ref) {
    const [permission, requestPermission] = useCameraPermissions();

    if (!permission) return null;

    if (!permission.granted) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Describe what&apos;s ahead</Text>
          <Text style={styles.detail}>
            AURA can watch through the camera and tell you about obstacles and
            signage. Nothing is recorded.
          </Text>
          <AccessibleButton
            label="Allow camera"
            variant="secondary"
            onPress={() => void requestPermission()}
            accessibilityHint="Lets AURA describe what is in front of you."
          />
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <View style={styles.row}>
          {/* Mounted so frames can be captured; small because it is not the point. */}
          <CameraView
            ref={ref}
            style={styles.preview}
            facing="back"
            animateShutter={false}
          />

          <View style={styles.status}>
            <Text style={styles.title}>
              {perception.running ? "Watching ahead" : "Camera idle"}
            </Text>
            <Text style={styles.detail}>
              {perception.running
                ? perception.connected
                  ? `${perception.cadence ?? "sampling"} · ${perception.framesSent} frames`
                  : "Vision node unreachable — retrying"
                : "Turn on to hear about obstacles and signage."}
            </Text>
          </View>
        </View>

        {perception.guidance ? (
          <Text style={styles.guidance}>“{perception.guidance}”</Text>
        ) : null}

        <View style={styles.actions}>
          <AccessibleButton
            label={perception.running ? "Stop watching" : "Watch ahead"}
            variant="secondary"
            onPress={perception.running ? perception.stop : perception.start}
            style={styles.action}
            accessibilityHint={
              perception.running
                ? "Stops sending camera frames."
                : "Starts describing obstacles and signage as you walk."
            }
          />
          <AccessibleButton
            label="What's ahead?"
            variant="secondary"
            onPress={perception.scanNow}
            style={styles.action}
            accessibilityHint="Describes what is in front of you right now."
          />
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.tight,
    padding: space.default,
  },
  row: {
    flexDirection: "row",
    gap: space.compact,
  },
  preview: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: colors.surfaceMuted,
  },
  status: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    color: colors.text,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.medium,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 18,
  },
  guidance: {
    color: colors.statusInfo,
    fontSize: fontSize.body,
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    gap: space.tight,
  },
  action: {
    flex: 1,
    paddingHorizontal: space.tight,
  },
});
