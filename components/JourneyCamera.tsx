import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { AccessibleButton } from "./AccessibleButton";
import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
import type { CameraPerception } from "../hooks/useCameraPerception";

type Props = {
  perception: CameraPerception;
};

/**
 * The camera strip on the journey screen.
 *
 * The preview is deliberately small: AURA_DESIGN.md section 09 gives the screen
 * to the map, and the traveller this is built for is not looking at either. It
 * is here so a sighted companion can see the lens is pointed at the ground and
 * that frames are actually going out — the same reason the GPS fix count is on
 * screen rather than implied.
 *
 * Everything the camera finds is also written here in words. What is spoken has
 * to be readable too: audio-only would leave out anyone who cannot hear it, and
 * a status conveyed only by a live preview would leave out anyone who cannot
 * see it (AURA_DESIGN.md section 30).
 */
export function JourneyCamera({ perception }: Props) {
  const [permission, requestPermission] = useCameraPermissions();

  // Ask once when the strip first appears. The traveller has already chosen to
  // be monitored; a second unexplained dialog later in the walk is worse.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Watching the path is off</Text>
        <Text style={styles.body}>
          AURA can describe broken pavement ahead of you, but it needs the camera.
        </Text>
        {permission.canAskAgain ? (
          <AccessibleButton
            label="Turn on the camera"
            variant="secondary"
            onPress={() => void requestPermission()}
            accessibilityHint="Lets AURA describe the ground ahead of you."
          />
        ) : (
          <Text style={styles.body}>
            Turn the camera on for AURA in Settings to use this.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <CameraView
        ref={perception.cameraRef}
        style={styles.preview}
        facing="back"
        active={perception.active}
        animateShutter={false}
        mute
        pictureSize={perception.pictureSize}
        onCameraReady={perception.onCameraReady}
      />

      <View style={styles.status}>
        <Text style={styles.statusLine} numberOfLines={1}>
          {describePhase(perception)}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {perception.error ??
            perception.lastHazardSpoken ??
            "Nothing on the path so far."}
        </Text>
      </View>
    </View>
  );
}

/**
 * Say what is happening, never more than is true. "Watching the path" claims
 * only that frames are going out — not that the ground is clear, and not that
 * every hazard would be caught. services/edge/HAZARD_MODEL.md lists what no
 * model here detects (kerbs, stairs, open manholes, raised paving, missing
 * tactile paving) and this copy must not imply otherwise.
 */
function describePhase(perception: CameraPerception): string {
  switch (perception.phase) {
    case "running": {
      const rate = perception.cadenceFps;
      const frames = `${perception.framesSent} frame${perception.framesSent === 1 ? "" : "s"}`;
      return rate
        ? `Watching the path · ${frames} · ${rate}/s`
        : `Watching the path · ${frames}`;
    }
    case "edge-unreachable":
      return "Not watching the path";
    case "waiting-for-camera":
      return "Starting the camera";
    case "no-permission":
      return "Watching the path is off";
    default:
      return "Camera idle";
  }
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.compact,
  },
  preview: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 48,
    overflow: "hidden",
    width: 64,
  },
  status: {
    flex: 1,
    gap: 2,
  },
  statusLine: {
    color: colors.text,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.compact,
    padding: space.compact,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
  },
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 18,
  },
});
