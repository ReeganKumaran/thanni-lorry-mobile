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
import { MyLocationIcon } from "./MyLocationIcon";
import { OsmMap } from "./OsmMap";
import { PlaceSizeSelector } from "./PlaceSizeSelector";
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
import { tapFeedback } from "../services/haptics";
import { getCurrentPosition, requestLocationPermission } from "../services/location";
import { speak } from "../services/speech";
import { DEFAULT_PLACE_SIZE, metersForSize } from "../types/api";
import type { PlaceSizeKey } from "../types/api";

type Props = {
  visible: boolean;
  /** Which place is being set — "Home", "Office", "College". */
  label: string;
  /** Where the map opens: the traveller's last known position. */
  initialLatitude: number;
  initialLongitude: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (latitude: number, longitude: number, radiusMeters: number) => void;
};

/**
 * Pick a place on OpenStreetMap.
 *
 * The map is the instrument here, so it gets the screen: everything else is a
 * thin bar above or below it. Dropping a pin accurately needs room to pan and
 * zoom, and a map squeezed into a strip is unusable however correct it is.
 *
 * Search still leads for anyone who cannot aim at a pin — typing an address is
 * the accessible route, and the selection is always read back as an address.
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
  const [size, setSize] = useState<PlaceSizeKey>(DEFAULT_PLACE_SIZE);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLatitude(initialLatitude);
    setLongitude(initialLongitude);
    setQuery("");
    setResults([]);
    setError(null);
    setAddress(null);
    setSize(DEFAULT_PLACE_SIZE);
  }, [visible, initialLatitude, initialLongitude]);

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

  /** Jump the pin back to wherever the traveller actually is. */
  const useCurrentLocation = async () => {
    tapFeedback();
    setLocating(true);
    setError(null);
    try {
      const permission = await requestLocationPermission();
      if (!permission.granted) {
        setError(
          permission.blocked
            ? "Location is off for AURA. Turn it on in Settings, or search instead."
            : "AURA needs your location to do that. Search for the address instead.",
        );
        return;
      }
      const here = await getCurrentPosition();
      setLatitude(here.latitude);
      setLongitude(here.longitude);
      setResults([]);
      speak("Moved to your current location.", "requested");
    } catch {
      setError("Couldn't get a GPS fix just now. Search for the address instead.");
    } finally {
      setLocating(false);
    }
  };

  const choose = (result: GeoResult) => {
    setLatitude(result.latitude);
    setLongitude(result.longitude);
    setAddress(result.label);
    setResults([]);
    setQuery("");
    speak(result.name, "requested");
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        {/* Header carries the title and the way out, so the bottom bar stays thin. */}
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
            Set {label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={styles.cancel}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel={`Search OpenStreetMap for your ${label} address`}
            placeholder="Search an address"
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

        {/* The map owns the screen; results take it over only while searching. */}
        <View style={styles.mapArea}>
          <OsmMap
            latitude={latitude}
            longitude={longitude}
            radiusMeters={metersForSize(size)}
            onPick={(lat, lng) => {
              setLatitude(lat);
              setLongitude(lng);
            }}
          />

          {/* Sits clear of Leaflet's attribution strip along the bottom edge. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Move the pin to my current location"
            accessibilityState={{ busy: locating }}
            disabled={locating}
            onPress={() => void useCurrentLocation()}
            style={styles.myLocation}
          >
            {locating ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <MyLocationIcon size={22} />
            )}
          </Pressable>

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
          ) : null}
        </View>

        <View style={styles.footer}>
          <PlaceSizeSelector value={size} onChange={setSize} disabled={busy} />

          <View
            accessible
            accessibilityLabel={`Selected: ${address ?? "locating the address"}`}
            style={styles.selection}
          >
            {address ? (
              <Text style={styles.selectionAddress} numberOfLines={2}>
                {address}
              </Text>
            ) : (
              <View style={styles.selectionLoading}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.selectionAddress}>Looking up the address…</Text>
              </View>
            )}
          </View>

          <AccessibleButton
            label={`Save as ${label}`}
            busy={busy}
            onPress={() => onConfirm(latitude, longitude, metersForSize(size))}
            accessibilityHint={`AURA stops checking in while you are at ${label}.`}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: space.default,
    paddingTop: space.default,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.section,
    fontWeight: fontWeight.semibold,
  },
  cancel: {
    justifyContent: "center",
    minHeight: touchTarget.min,
    paddingHorizontal: space.tight,
  },
  cancelLabel: {
    color: colors.statusInfo,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  searchRow: {
    flexDirection: "row",
    gap: space.tight,
    paddingHorizontal: space.default,
    paddingVertical: space.tight,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.body,
    minHeight: touchTarget.min,
    paddingHorizontal: space.compact,
  },
  searchButton: {
    minHeight: touchTarget.min,
    paddingHorizontal: space.compact,
  },
  error: {
    color: colors.statusRisk,
    fontSize: fontSize.meta,
    paddingHorizontal: space.default,
  },
  mapArea: {
    flex: 1,
    marginHorizontal: space.default,
    marginVertical: space.tight,
  },
  myLocation: {
    position: "absolute",
    right: space.compact,
    // Clear of both Leaflet's attribution strip and the map's rounded corner.
    bottom: 38,
    alignItems: "center",
    justifyContent: "center",
    width: touchTarget.min,
    height: touchTarget.min,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    // Lifted off the map so it reads as a control, not part of the tiles.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  results: {
    ...StyleSheet.absoluteFillObject,
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
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: space.tight,
    paddingBottom: space.default,
    paddingHorizontal: space.default,
    paddingTop: space.compact,
  },
  selection: {
    minHeight: 22,
  },
  selectionLoading: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
  },
  selectionAddress: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 18,
  },
});
