import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { AccessibleButton } from "./AccessibleButton";
import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import {
  deleteTrustedContact,
  getTrustedContactStatus,
  saveTrustedContact,
} from "../services/api";
import type { TrustedContactStatus } from "../services/api";

/**
 * Who AURA calls when it escalates.
 *
 * This used to be a server environment variable, which meant the traveller
 * could not see it, change it, or find out whether anybody would be reached at
 * all. For a safety product that is the wrong place for it: the number belongs
 * to the person, not the deployment.
 *
 * The panel always states the current situation in words rather than only
 * showing a filled or empty field, because "AURA has nobody to call" has to be
 * learnable before a journey, not after a failed escalation.
 */
/** One sentence, used for both the screen and the screen reader. */
function contactWarning(usingFallback: boolean): string {
  return usingFallback
    ? "AURA would call a number set on the server, not one you chose. Add your own so the right person is reached."
    : "AURA has nobody to call. If you ask for help, an alert is raised but no one is phoned.";
}

export function EmergencyContactPanel() {
  const [status, setStatus] = useState<TrustedContactStatus | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function refresh() {
    try {
      setStatus(await getTrustedContactStatus());
    } catch {
      // Offline is not an error worth shouting about here; the banner elsewhere
      // already says the backend is unreachable.
      setStatus(null);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Give them a name, so AURA can say who it called.");
      return;
    }
    setBusy(true);
    try {
      await saveTrustedContact(name.trim(), phone.trim());
      setEditing(false);
      setPhone("");
      await refresh();
    } catch (e) {
      // The server is the authority on what a valid number is; show what it said.
      setError(
        e instanceof Error && e.message
          ? "That number was not accepted. Use the country code, like +91 98765 43210."
          : "Could not save. Check the backend connection.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteTrustedContact();
      await refresh();
    } catch {
      setError("Could not remove the contact.");
    } finally {
      setBusy(false);
    }
  }

  const hasContact = status?.configured === true && status.source === "traveller";
  const usingFallback = status?.configured === true && status.source === "environment";

  return (
    <View style={styles.card} accessibilityLabel="Emergency contact">
      <Text style={styles.title}>Who should AURA call?</Text>

      {hasContact ? (
        <Text style={styles.summary}>
          {status?.name} · {status?.phone_redacted}
        </Text>
      ) : (
        /* The marker carries the warning, not the colour: statusAttention is
           4.48:1 on surface, under the AA floor for 16px text. Amber on the
           shape, full contrast on the words.

           The label is spelled out because `accessible` merges the children, and
           without it a screen reader reads the decorative ▲ as "up-pointing
           triangle" before the sentence. Same reason NavigationBanner hides its
           arrow: the glyph is for the eye, the sentence is the message. */
        <View accessible accessibilityLabel={contactWarning(usingFallback)} style={styles.warningRow}>
          <Text style={styles.warningMarker}>▲</Text>
          <Text style={styles.warning}>{contactWarning(usingFallback)}</Text>
        </View>
      )}

      {editing || !hasContact ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Their name"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel="Contact name"
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+91 98765 43210"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            accessibilityLabel="Contact phone number, with country code"
            accessibilityHint="Start with a plus and the country code"
          />
          <Text style={styles.hint}>
            Include the country code. AURA never shows the full number again.
          </Text>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <AccessibleButton
            label={hasContact ? "Save new contact" : "Save contact"}
            onPress={save}
            busy={busy}
            disabled={busy}
          />
          {hasContact ? (
            <AccessibleButton
              label="Cancel"
              variant="secondary"
              onPress={() => {
                setEditing(false);
                setError(null);
              }}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.form}>
          <AccessibleButton
            label="Change contact"
            variant="secondary"
            onPress={() => {
              setEditing(true);
              setName(status?.name ?? "");
              setPhone("");
            }}
          />
          <AccessibleButton
            label="Remove contact"
            variant="secondary"
            onPress={remove}
            disabled={busy}
            accessibilityHint="AURA will have nobody to call"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.default,
    gap: space.tight,
  },
  title: {
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  summary: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  warningRow: {
    flexDirection: "row",
    gap: space.tight,
  },
  warningMarker: {
    color: colors.statusAttention,
    fontSize: fontSize.meta,
    lineHeight: 22,
  },
  warning: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 22,
  },
  form: {
    gap: space.tight,
    marginTop: space.tight,
  },
  input: {
    minHeight: touchTarget.comfortable,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.compact,
    fontSize: fontSize.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  hint: {
    fontSize: fontSize.meta,
    color: colors.textSecondary,
  },
  error: {
    fontSize: fontSize.meta,
    color: colors.statusRisk,
  },
});
