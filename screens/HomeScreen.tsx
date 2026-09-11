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
import { EmergencyContactPanel } from "../components/EmergencyContactPanel";
import { TravellerNamePanel } from "../components/TravellerNamePanel";
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

  const connection = summariseConnection(backendState, edgeState);
  const ready = destination.trim().length > 0;

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

        {/* One task, uninterrupted: say where you are going and start. Everything
            that is not that now sits below its own heading, so the screen reads
            as three decisions rather than eight stacked cards. */}
        <View style={styles.task}>
          <TextInput
            accessibilityLabel="Destination"
            accessibilityHint="Type where you are travelling to."
            placeholder="Railway Station"
            placeholderTextColor={colors.textSecondary}
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
                  style={({ pressed }) => [
                    styles.quickChip,
                    selected && styles.quickChipSelected,
                    pressed && styles.quickChipPressed,
                  ]}
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
            disabled={!ready}
            accessibilityHint="Begins sharing your location with AURA."
          />

          {!ready ? (
            <Text style={styles.startHint}>
              Type where you&apos;re going, or tap one above.
            </Text>
          ) : null}

          <VoiceButton
            listening={voice.listening}
            onPress={voice.listen}
            lastHeard={voice.lastHeard}
          />
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionLabel}>
            Before you go
          </Text>
          <TravellerNamePanel />
          <EmergencyContactPanel />
          <PlacePanel
            place={place}
            canSave
            onSave={(label, radiusMeters) => savePlace(label, undefined, radiusMeters)}
            onPickOnMap={(label) => setPickingLabel(label)}
          />
        </View>

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

        {/* Last, and quiet. AURA_DESIGN.md section 39: setup plumbing is kept
            apart from the user-facing experience, and the production UI should
            never look like a simulator. One line states whether AURA can be
            reached — the thing the traveller actually needs before walking out
            — and the host addresses live behind it. */}
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionLabel}>
            Connection
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={connection.label}
            accessibilityHint="Opens the backend host settings."
            accessibilityState={{ expanded: showBackend }}
            onPress={() => setShowBackend((open) => !open)}
            style={({ pressed }) => [styles.connectionRow, pressed && styles.rowPressed]}
          >
            {/* Hue on the dot, which is a graphic at a 3:1 floor. The label says
                it in words, so nothing depends on seeing the colour. */}
            <View style={[styles.dot, { backgroundColor: connection.color }]} />
            <Text style={styles.connectionLabel} numberOfLines={2}>
              {connection.label}
            </Text>
            <Text style={styles.rowAction}>{showBackend ? "Hide" : "Change"}</Text>
          </Pressable>

          {showBackend ? (
            <View style={styles.backendForm}>
              <View style={styles.hostRow}>
                <Text style={styles.hostName}>AURA</Text>
                <Text style={styles.hostOrigin} numberOfLines={1}>
                  {getApiOrigin()}
                </Text>
              </View>
              <View style={styles.hostRow}>
                <Text style={styles.hostName}>Hazard camera</Text>
                <Text style={styles.hostOrigin} numberOfLines={1}>
                  {getEdgeOrigin()}
                </Text>
              </View>

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
                placeholder="192.168.1.10:8200"
                placeholderTextColor={colors.textSecondary}
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

/**
 * Two services, one line.
 *
 * The API and the hazard node fail independently, and both used to get a row of
 * their own with its URL — two lines of deployment detail in the middle of the
 * traveller's screen. The node going down is still worth saying out loud, so it
 * survives here as the worst of the two states in plain language; the addresses
 * move behind the disclosure where whoever is wiring it up will look.
 */
function summariseConnection(
  api: BackendState,
  edge: BackendState,
): { label: string; color: string } {
  if (api === "checking" || edge === "checking") {
    return { label: "Checking the connection", color: colors.textMuted };
  }
  if (api === "unreachable") {
    return { label: "Can't reach AURA — it won't be watching your journey", color: colors.statusRisk };
  }
  if (api === "reachable" && edge === "unreachable") {
    return {
      label: "AURA connected · not watching for broken pavement",
      color: colors.statusAttention,
    };
  }
  if (api === "reachable") {
    return { label: "AURA connected", color: colors.statusSafe };
  }
  return { label: "Connection not checked yet", color: colors.textMuted };
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: space.section,
    gap: space.large,
  },
  header: {
    gap: space.tight,
    paddingTop: space.large,
  },
  wordmark: {
    // Not textMuted: #8A8A84 on the background is 3.24:1, under AA for 13px.
    color: colors.textSecondary,
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
  task: {
    gap: space.default,
  },
  /**
   * A 1px rule and a label, not a card. AURA_DESIGN.md section 40 asks whether
   * there are unnecessary cards, and wrapping an already-bordered panel in
   * another bordered box is the card-on-card depth rule 5 rules out.
   */
  section: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: space.compact,
    paddingTop: space.default,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
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
  quickChipPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  quickLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  quickLabelSelected: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  startHint: {
    color: colors.textSecondary,
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
  connectionRow: {
    alignItems: "center",
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: space.tight,
    minHeight: touchTarget.min,
  },
  rowPressed: {
    opacity: 0.6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionLabel: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.meta,
  },
  rowAction: {
    color: colors.statusInfo,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
  },
  backendForm: {
    gap: space.compact,
  },
  hostRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
  },
  hostName: {
    color: colors.text,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
    width: 112,
  },
  hostOrigin: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.meta,
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
