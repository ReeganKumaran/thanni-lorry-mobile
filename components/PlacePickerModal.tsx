import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AccessibleButton } from "./AccessibleButton";
import { OsmMap } from "./OsmMap";
import {
  colors,
  fontSize,
  fontWeight,
  radius,
  space,
  touchTarget,
} from "../constants/theme";
import { describeCoordinates, searchPlaces } from "../services/geocoding";
import type { GeoResult } from "../services/geocoding";
import { speak } from "../services/speech";

type Props = {
  visible: boolean;
  /** Which place is being set — "Home", "Office", "College". */
  label: string;
  /** Where the map opens: the traveller's last known position. */
  initialLatitude: number;
  initialLongitude: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (latitude: number, longitude: number) => void;
};

/**
 * Pick a place on OpenStreetMap.
 *
 * Search leads, because typing an address is the route that works without
 * sight; the map confirms it. The chosen point is always described back as an
 * address so the selection can be checked by ear.
 */
export function PlacePickerModal({
  visible,
  label,
  initialLatitude,
  initialLongitude,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latitude, setLatitude] = useState(initialLatitude);
  const [longitude, setLongitude] = useState(initialLongitude);
  const [address, setAddress] = useState<string | null>(null);

  // Re-open on the current position rather than wherever it was left.
  useEffect(() => {
    if (!visible) return;
    setLatitude(initialLatitude);
    setLongitude(initialLongitude);
    setQuery("");
    setResults([]);
    setError(null);
    setAddress(null);
  }, [visible, initialLatitude, initialLongitude]);

  // Describe whatever the pin currently sits on.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    void (async () => {
      const described = await describeCoordinates(latitude, longitude);
      if (!cancelled) setAddress(described);
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, latitude, longitude]);

  const runSearch = async () => {
    if (query.trim().length < 3) {
      setError("Type at least three characters to search.");
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const found = await searchPlaces(query);
      setResults(found);
      if (found.length === 0) setError("Nothing on OpenStreetMap matched that.");
      else speak(`${found.length} places found.`, "requested");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const choose = (result: GeoResult) => {
    setLatitude(result.latitude);
    setLongitude(result.longitude);
    setAddress(result.label);
    setResults([]);
    speak(result.name, "requested");
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <Text accessibilityRole="header" style={styles.title}>
          Set {label}
        </Text>
        <Text style={styles.subtitle}>
          Search for the address, or tap the map to move the pin.
        </Text>

        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel={`Search OpenStreetMap for your ${label} address`}
            placeholder="Street, area or landmark"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void runSearch()}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.input}
          />
          <AccessibleButton
            label="Search"
            variant="secondary"
            busy={searching}
            onPress={() => void runSearch()}
            style={styles.searchButton}
          />
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {results.length > 0 ? (
          <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
            {results.map((result) => (
              <Pressable
                key={`${result.latitude},${result.longitude}`}
                accessibilityRole="button"
                accessibilityLabel={result.label}
                onPress={() => choose(result)}
                style={styles.result}
              >
                <Text style={styles.resultName}>{result.name}</Text>
                <Text style={styles.resultAddress} numberOfLines={2}>
                  {result.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <OsmMap
            latitude={latitude}
            longitude={longitude}
            onPick={(lat, lng) => {
              setLatitude(lat);
              setLongitude(lng);
            }}
          />
        )}

        <View
          accessible
          accessibilityLabel={`Selected: ${address ?? "locating"}`}
          style={styles.selection}
        >
          <Text style={styles.selectionLabel}>Selected</Text>
          {address ? (
            <Text style={styles.selectionAddress}>{address}</Text>
          ) : (
            <View style={styles.selectionLoading}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={styles.selectionAddress}>Looking up the address…</Text>
            </View>
          )}
          <Text style={styles.coords}>
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </Text>
        </View>

        <View style={styles.actions}>
          <AccessibleButton
            label={`Save as ${label}`}
            busy={busy}
            onPress={() => onConfirm(latitude, longitude)}
            accessibilityHint={`AURA stops checking in while you are at ${label}.`}
          />
          <AccessibleButton label="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    gap: space.compact,
    paddingHorizontal: space.section,
    paddingTop: space.large,
    paddingBottom: space.section,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.pageTitle,
    fontWeight: fontWeight.semibold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  searchRow: {
    flexDirection: "row",
    gap: space.tight,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.body,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: space.default,
  },
  searchButton: {
    paddingHorizontal: space.default,
  },
  error: {
    color: colors.statusRisk,
    fontSize: fontSize.meta,
  },
  results: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  result: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget.comfortable,
    paddingHorizontal: space.default,
    paddingVertical: space.compact,
  },
  resultName: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  resultAddress: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
  },
  selection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.micro,
    padding: space.compact,
  },
  selectionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.medium,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  selectionLoading: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
  },
  selectionAddress: {
    color: colors.text,
    fontSize: fontSize.body,
    lineHeight: 21,
  },
  coords: {
    color: colors.textMuted,
    fontSize: fontSize.meta,
  },
  actions: {
    gap: space.tight,
  },
});
