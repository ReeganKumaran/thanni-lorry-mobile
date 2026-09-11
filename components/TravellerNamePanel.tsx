/**
 * The name a trusted contact or an operator sees instead of a journey id.
 *
 * Optional by design. Nothing about the monitoring changes if it is left blank
 * — the backend reaches the same safety verdict either way — so the copy says
 * so rather than implying the traveller has to identify themselves to be kept
 * safe (AURA_DESIGN.md §30, §40).
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { AccessibleButton } from "./AccessibleButton";
import { getDeviceLabel, getTravellerName, setTravellerName } from "../services/device";
import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";

export function TravellerNamePanel() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getTravellerName().then((stored) => {
      setSaved(stored);
      setName(stored ?? "");
    });
  }, []);

  async function save() {
    setBusy(true);
    const next = name.trim();
    await setTravellerName(next.length > 0 ? next : null);
    setSaved(next.length > 0 ? next : null);
    setBusy(false);
  }

  const changed = (saved ?? "") !== name.trim();

  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Your name</Text>
      <Text style={styles.help}>
        Shown to your trusted contact if AURA has to call them. Leave it blank if
        you would rather not — you are monitored exactly the same either way.
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Optional"
        placeholderTextColor={colors.textSecondary}
        maxLength={60}
        accessibilityLabel="Your name, optional"
        style={styles.input}
      />

      <Text style={styles.device}>This phone: {getDeviceLabel()}</Text>

      {changed ? (
        <AccessibleButton
          label={busy ? "Saving…" : "Save name"}
          onPress={save}
          disabled={busy}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.default,
    gap: space.tight,
  },
  label: {
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  help: { fontSize: fontSize.meta, color: colors.textSecondary },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: space.compact,
    fontSize: fontSize.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  device: { fontSize: fontSize.meta, color: colors.textMuted },
});
