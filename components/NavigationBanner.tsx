import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { border, colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import type { Maneuver, NavigationInstruction } from "../types/api";

type Props = {
  instruction: NavigationInstruction | null;
  /** False when the backend has no route, so there is nothing to guide along. */
  routeMonitoring: boolean;
};

/**
 * The next instruction, in text.
 *
 * It is spoken as well, but speech is not a substitute for the screen: voice
 * guidance can be muted, missed, or drowned out, and a Deaf or hard-of-hearing
 * traveller never hears it at all. AURA_DESIGN.md section 30 — never rely on a
 * single channel to carry a fact the traveller needs.
 *
 * The arrow is decorative and hidden from assistive technology: the direction is
 * already in the sentence, and a screen reader announcing "arrow left, turn
 * left in twenty metres" says the same thing twice.
 */
const ARROW: Record<Maneuver, string> = {
  STRAIGHT: "↑",
  LEFT: "←",
  RIGHT: "→",
  ARRIVE: "◎",
  OFF_ROUTE: "!",
};

/**
 * Off-route is the one instruction that is not guidance but a warning, so it is
 * the one that carries a status colour. Everything else stays neutral — a turn
 * arriving in amber every thirty seconds would train the traveller to ignore
 * the colour that matters.
 *
 * The status hue goes on the border and the arrow, never on the instruction
 * text. `statusAttention` (#A66A00) on `surface` measures 4.48:1 — under the
 * 4.5:1 WCAG AA floor for body text at this size and weight, though comfortably
 * over the 3:1 floor for a border. The console's `ThreatBadge` reached the same
 * conclusion for the same token; the text stays `colors.text` at 17.93:1, and
 * the maneuver is already carried by the arrow and by the wording.
 */
function toneFor(maneuver: Maneuver): { border: string; accent: string } {
  if (maneuver === "OFF_ROUTE") {
    return { border: colors.statusAttention, accent: colors.statusAttention };
  }
  if (maneuver === "ARRIVE") {
    return { border: colors.statusSafe, accent: colors.statusSafe };
  }
  return { border: colors.border, accent: colors.text };
}

export function NavigationBanner({ instruction, routeMonitoring }: Props) {
  /**
   * What assistive technology is told, which changes less often than what is
   * drawn.
   *
   * The visible text carries a live countdown, because a sighted traveller
   * glancing down wants the current distance. But `instruction.text` rounds
   * distance on a finer grid than the backend's `key` buckets it, so wiring a
   * live region straight to it would make TalkBack re-announce roughly once a
   * second while approaching a turn — while the voice channel beside it is
   * correctly throttled to a handful of announcements. That is precisely the
   * "buried under machine-generated narration" failure AURA_DESIGN.md section 32
   * exists to prevent. Keying this on `key` makes both channels equally sparse.
   */
  const announced = useMemo(
    () => instruction?.text ?? "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [instruction?.key],
  );

  if (!routeMonitoring) {
    return (
      <View style={styles.container}>
        <Text style={styles.quiet}>
          No planned route — watching for long stops
        </Text>
      </View>
    );
  }

  if (!instruction) return null;

  const tone = toneFor(instruction.maneuver);

  return (
    <View
      // `accessible` promotes this into a single accessibility node, so the
      // label and the live region actually apply — without it AT can fall
      // through to the bare child Text, which carries neither. Matches
      // SafetyStatusBanner, JourneyStats and ConnectionBadge.
      accessible
      // A live region: the instruction changes while the traveller is walking
      // and holding the phone, not reading it. Android honours this; iOS has no
      // View equivalent, so useJourneyMonitor announces there explicitly.
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessibilityLabel={announced}
      style={[styles.container, { borderColor: tone.border }]}
    >
      <Text
        // iOS and Android respectively; both are needed to keep a decorative
        // glyph out of the accessibility tree.
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.arrow, { color: tone.accent }]}
      >
        {ARROW[instruction.maneuver]}
      </Text>
      {/* Always full-contrast: the status hue lives on the border and arrow. */}
      <Text style={styles.text} numberOfLines={2}>
        {instruction.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: border.width,
    flexDirection: "row",
    gap: space.compact,
    // The banner is read, not tapped, so the minimum touch target is the right
    // floor for it rather than a number invented here.
    minHeight: touchTarget.min,
    paddingHorizontal: space.default,
    paddingVertical: space.tight,
  },
  arrow: {
    fontSize: fontSize.section,
    fontWeight: fontWeight.medium,
  },
  text: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.medium,
  },
  quiet: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
