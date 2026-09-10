import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AccessibleButton } from "../components/AccessibleButton";
import { PlacePanel } from "../components/PlacePanel";
import { PlacePickerModal } from "../components/PlacePickerModal";
import { VoiceButton } from "../components/VoiceButton";
import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import { checkHealth } from "../services/api";
import { checkEdgeHealth } from "../services/perception";
import { getApiOrigin, getEdgeOrigin, setApiOrigin } from "../services/config";
import type { PlaceState } from "../hooks/useJourneyMonitor";
import { useVoiceControl } from "../hooks/useVoiceControl";

type Props = {
  starting: boolean;
  error: string | null;
  onStart: (destination: string) => void;
  onDismissError: () => void;
  place: PlaceState;
  savePlace: (
    label: string,
    coords?: { latitude: number; longitude: number },
    radiusMeters?: number,
  ) => void;
};

/** Fallbacks until the traveller has saved any places of their own. */
const FALLBACK_DESTINATIONS = ["Home", "Work", "Station"];

type BackendState = "unknown" | "checking" | "reachable" | "unreachable";

export function HomeScreen({
  starting,
  error,
  onStart,
  onDismissError,
  place,
  savePlace,
}: Props) {
  const [pickingLabel, setPickingLabel] = useState<string | null>(null);

  // Saying where you are going is the whole flow for someone who cannot type.
  const voice = useVoiceControl({
    onStart: (spokenDestination) => onStart(spokenDestination),
    describeLocation: () => "You haven't started a journey yet.",
  });

  // Your saved places are the destinations you actually travel to.
  const quickDestinations =
    place.saved.length > 0
      ? place.saved.map((p) => p.label).slice(0, 4)
      : FALLBACK_DESTINATIONS;
  const [destination, setDestination] = useState("");
  const [showBackend, setShowBackend] = useState(false);
  const [host, setHost] = useState(getApiOrigin());
  const [backendState, setBackendState] = useState<BackendState>("unknown");
  const [edgeState, setEdgeState] = useState<BackendState>("unknown");

  const probe = useCallback(async () => {
    setBackendState("checking");
    setEdgeState("checking");
    // Both, before a journey starts. The edge node used to be discovered only
    // when a frame failed mid-walk, which is the worst moment to learn the
    // host is wrong — and the traveller this is built for cannot see the
    // camera strip go quiet.
    const [api, edge] = await Promise.all([checkHealth(), checkEdgeHealth()]);
    setBackendState(api ? "reachable" : "unreachable");
    setEdgeState(edge ? "reachable" : "unreachable");
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const applyHost = () => {
    setHost(setApiOrigin(host));
    onDismissError();
    void probe();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.wordmark}>AURA</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Where are you heading?
          </Text>
          <Text style={styles.subtitle}>
            AURA follows your journey and asks if something looks wrong.
          </Text>
        </View>

        <TextInput
          accessibilityLabel="Destination"
          accessibilityHint="Type where you are travelling to."
          placeholder="Railway Station"
          placeholderTextColor={colors.textMuted}
          value={destination}
          onChangeText={(next) => {
            setDestination(next);
            if (error) onDismissError();
          }}
          onSubmitEditing={() => onStart(destination)}
          returnKeyType="go"
          style={styles.input}
        />

        <View style={styles.quickRow}>
          {quickDestinations.map((preset) => {
            const selected = destination.trim() === preset;
            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                accessibilityLabel={preset}
                accessibilityState={{ selected }}
                onPress={() => setDestination(preset)}
                style={[styles.quickChip, selected && styles.quickChipSelected]}
              >
                <Text style={[styles.quickLabel, selected && styles.quickLabelSelected]}>
                  {preset}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <View accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <AccessibleButton
          label="Start monitored journey"
          onPress={() => onStart(destination)}
          busy={starting}
          disabled={destination.trim().length === 0}
          accessibilityHint="Begins sharing your location with AURA."
        />

        {destination.trim().length === 0 ? (
          <Text style={styles.startHint}>
            Type where you&apos;re going, or tap one above.
          </Text>
        ) : null}

        <VoiceButton
          listening={voice.listening}
          onPress={voice.listen}
          lastHeard={voice.lastHeard}
          style={styles.voice}
        />

        <PlacePanel
          place={place}
          canSave
          onSave={(label, radiusMeters) => savePlace(label, undefined, radiusMeters)}
          onPickOnMap={(label) => setPickingLabel(label)}
        />

        <PlacePickerModal
          visible={pickingLabel !== null}
          label={pickingLabel ?? ""}
          initialLatitude={13.0827}
          initialLongitude={80.2707}
          busy={place.saving}
          onCancel={() => setPickingLabel(null)}
          onConfirm={(latitude, longitude, radiusMeters) => {
            const label = pickingLabel;
            setPickingLabel(null);
            if (label) savePlace(label, { latitude, longitude }, radiusMeters);
          }}
        />

        <View style={styles.backend}>
          <Pressable
            accessibilityRole="button"
            // backendLabel already begins with "Backend", so prefixing it made
            // a screen reader say "Backend Backend connected".
            accessibilityLabel={`${backendLabel(backendState)}. ${getApiOrigin()}`}
            accessibilityHint="Opens the backend host setting."
            onPress={() => setShowBackend((open) => !open)}
            style={styles.backendSummary}
          >
            <View
              style={[styles.dot, { backgroundColor: backendColor(backendState) }]}
            />
            <Text style={styles.backendText} numberOfLines={1}>
              {backendLabel(backendState)} · {getApiOrigin()}
            </Text>
            <Text style={styles.backendToggle}>{showBackend ? "Hide" : "Change"}</Text>
          </Pressable>

          {/* The camera's hazard detection runs on a separate service, so it
              can be down while the backend is fine. Shown here rather than
              discovered when a frame fails. */}
          <View
            accessible
            accessibilityLabel={`${edgeLabel(edgeState)}. ${getEdgeOrigin()}`}
            style={styles.backendSummary}
          >
            <View style={[styles.dot, { backgroundColor: backendColor(edgeState) }]} />
            <Text style={styles.backendText} numberOfLines={1}>
              {edgeLabel(edgeState)} · {getEdgeOrigin()}
            </Text>
          </View>

          {showBackend ? (
            <View style={styles.backendForm}>
              <Text style={styles.backendHint}>
                Over USB, leave this as localhost and run{" "}
                <Text style={styles.backendCode}>adb reverse</Text>. Over Wi-Fi the
                phone cannot see the laptop&apos;s localhost, so enter its LAN
                address. The camera&apos;s hazard node follows the same host on its
                own port.
              </Text>
              <TextInput
                accessibilityLabel="Backend host"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="192.168.1.10:8000"
                placeholderTextColor={colors.textMuted}
                value={host}
                onChangeText={setHost}
                onSubmitEditing={applyHost}
                style={styles.input}
              />
              <AccessibleButton
                label="Use this host"
                variant="secondary"
                onPress={applyHost}
                busy={backendState === "checking"}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function backendLabel(state: BackendState): string {
  switch (state) {
    case "reachable":
      return "Backend connected";
    case "unreachable":
      return "Backend unreachable";
    case "checking":
      return "Checking backend";
    default:
      return "Backend";
  }
}

function edgeLabel(state: BackendState): string {
  switch (state) {
    case "reachable":
      return "Hazard camera connected";
    case "unreachable":
      return "Hazard camera unreachable";
    case "checking":
      return "Checking hazard camera";
    default:
      return "Hazard camera";
  }
}

function backendColor(state: BackendState): string {
  switch (state) {
    case "reachable":
      return colors.statusSafe;
    case "unreachable":
      return colors.statusRisk;
    default:
      return colors.textMuted;
  }
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: space.section,
    gap: space.section,
  },
  header: {
    gap: space.tight,
    paddingTop: space.large,
  },
  wordmark: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.semibold,
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.pageTitle,
    fontWeight: fontWeight.semibold,
    lineHeight: 40,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.section,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: space.default,
    paddingVertical: space.compact,
  },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.tight,
  },
  quickChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.min,
    paddingHorizontal: space.compact,
  },
  quickChipSelected: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.text,
  },
  quickLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  quickLabelSelected: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  voice: {
    paddingTop: space.tight,
  },
  startHint: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
    marginTop: -space.tight,
    textAlign: "center",
  },
  error: {
    backgroundColor: colors.surface,
    borderColor: colors.statusRisk,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.default,
  },
  errorText: {
    color: colors.statusRisk,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  backend: {
    gap: space.compact,
  },
  backendSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
    minHeight: touchTarget.min,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  backendText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: fontSize.meta,
  },
  backendToggle: {
    color: colors.statusInfo,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  backendForm: {
    gap: space.compact,
  },
  backendHint: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 19,
  },
  backendCode: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
});
