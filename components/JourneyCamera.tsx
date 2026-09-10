import { useEffect } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
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
        <Text style={styles.title}>Watching for broken pavement is off</Text>
        <Text style={styles.body}>
          AURA can describe broken pavement ahead of you, but it needs the camera.
        </Text>
        {permission.canAskAgain ? (
          <AccessibleButton
            label="Turn on the camera"
            variant="secondary"
            onPress={() => void requestPermission()}
            accessibilityHint="Lets AURA describe broken pavement ahead of you."
          />
        ) : (
          <>
            <Text style={styles.body}>
              Turn the camera on for AURA in Settings to use this.
            </Text>
            {/* A blind traveller should not have to hunt through Settings on
                their own to undo this. */}
            <AccessibleButton
              label="Open Settings"
              variant="secondary"
              onPress={() => void Linking.openSettings()}
              accessibilityHint="Opens AURA's permissions in the system settings."
            />
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {/* Nothing here for a screen reader: the doc comment above explains the
          preview is for a sighted companion. Left visible it becomes an extra
          unlabelled stop while swiping through the sheet. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
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
      </View>

      {/* One stop, one announcement, rather than two fragments. Polite, so it
          waits for anything the screen reader is already saying. */}
      <View
        accessible
        accessibilityLabel={`${describePhase(perception)}. ${describeDetail(perception)}`}
        accessibilityLiveRegion="polite"
        style={styles.status}
      >
        {/* Two lines: scoping the claim to "broken pavement" made this longer
            than one line, and truncating it dropped the frame count and rate —
            the evidence that capture is actually running. */}
        <Text style={styles.statusLine} numberOfLines={2}>
          {describePhase(perception)}
        </Text>
        {/* Deliberately unbounded: "Stop. There is broken, uneven pavement
            right in front of you on your right." must not be cut in half, and
            it gets longer at larger font scales, not shorter. */}
        <Text style={styles.detail}>{describeDetail(perception)}</Text>
      </View>
    </View>
  );
}

/**
 * "Check the path" — a deliberate look, on demand.
 *
 * Someone who stops and aims the phone is asking a question. Passive sampling
 * drops to one frame every five seconds when they stand still, so without this
 * the question went unanswered and the feature felt dead. It always replies,
 * including when it finds nothing.
 */
export function CheckPathButton({ perception }: Props) {
  return (
    <AccessibleButton
      label={perception.scanning ? "Looking…" : "Check the path"}
      variant="secondary"
      busy={perception.scanning}
      onPress={perception.scanNow}
      accessibilityHint="Looks at the ground ahead now and says what is there. Finds broken and cracked pavement; it cannot reliably see potholes, kerbs or steps."
    />
  );
}

/**
 * Say what is happening, never more than is true. "Watching for broken
 * pavement" is the whole claim: frames are going out and that is the one
 * surface hazard the model detects reliably. services/edge/HAZARD_MODEL.md
 * lists what nothing here detects — kerbs, stairs, open manholes, raised
 * paving, missing tactile paving — and this copy must not imply otherwise.
 */
/**
 * The node's own word for the tier it has chosen, in the traveller's language.
 *
 * A stationary journey samples once every five seconds, which on screen looked
 * identical to a freeze and drove the "hazard detection is dead" report. Naming
 * the tier makes an idle 0.2/s visibly idle — and tells the reader that
 * standing still is exactly when to use Check the path.
 */
function describeTier(mode: string | null, fps: number | null): string {
  const rate = fps ? ` · ${fps}/s` : "";
  switch (mode) {
    case "stationary":
      return `Idle while you're still${rate}`;
    case "walking":
      return `Watching as you walk${rate}`;
    case "alert":
      return `Checking closely${rate}`;
    default:
      return rate ? `Watching${rate}` : "Watching";
  }
}

function describePhase(perception: CameraPerception): string {
  switch (perception.phase) {
    case "running": {
      if (perception.scanning) return "Looking now…";
      const frames = `${perception.framesSent} frame${perception.framesSent === 1 ? "" : "s"}`;
      return `${describeTier(perception.cadenceMode, perception.cadenceFps)} · ${frames}`;
    }
    case "edge-unreachable":
      return "Not watching for broken pavement";
    case "waiting-for-camera":
      return "Starting the camera";
    case "no-permission":
      return "Watching for broken pavement is off";
    default:
      return "Camera idle";
  }
}

/**
 * "No broken pavement seen so far" and not "nothing on the path": the second
 * claims the path is clear, which this cannot know. Kerbs, stairs, open
 * manholes, raised paving and missing tactile paving are detected by nothing
 * wired in — the hazards most likely to actually hurt someone.
 */
function describeDetail(perception: CameraPerception): string {
  return (
    perception.error ??
    perception.lastHazardSpoken ??
    "No broken pavement seen so far."
  );
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
    // Not colors.surface: AccessibleButton's secondary variant fills with
    // surface too, so the only thing separating the button from the card was a
    // 1px colors.border edge at 1.35:1 — under the 3:1 WCAG 1.4.11 floor for a
    // control's boundary. surfaceMuted is a locked token and gives the button
    // an actual fill contrast.
    backgroundColor: colors.surfaceMuted,
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
