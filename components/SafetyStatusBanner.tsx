import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { presentSafetyState } from "../constants/safety";
import { colors, fontSize, fontWeight, motion, space } from "../constants/theme";
import { useReducedMotion } from "../hooks/useReducedMotion";
import type { SafetyState } from "../types/api";

type Props = {
  state: SafetyState;
  destination?: string | null;
  /** Set while inside a saved place, where no checks are raised. */
  pausedAt?: string | null;
  /** Controls that belong beside the status — the End button, the offline badge. */
  trailing?: ReactNode;
};

/**
 * The one place the traveller looks to know where they stand.
 *
 * Three densities, from AURA_DESIGN.md section 37, because a screen that looks
 * identical in SAFE and ESCALATED makes the traveller read it to find out which
 * one they are in:
 *
 *   normal      one quiet line on the page ground, under a hairline.
 *   attention   a ruled band: the explanation appears, the headline grows.
 *   critical    the same band under one heavier rule in the status colour.
 *
 * It is the first thing on the journey screen and the largest type on it, which
 * is the whole hierarchy in one line: the verdict, then the evidence that AURA
 * is still watching, then what it can see, then the controls, then the map.
 *
 * Status is carried by text and a shape marker as well as colour
 * (AURA_DESIGN.md section 30). The hue sits on the border and the marker and
 * never on the words: `statusAttention` (#A66A00) on `surface` is 4.48:1, under
 * the 4.5:1 AA floor for body text but comfortably over the 3:1 floor for a
 * border and a non-text graphic. `NavigationBanner` reached the same conclusion
 * for the same token, and the headline stays `colors.text` at 17.93:1.
 */
export function SafetyStatusBanner({ state, destination, pausedAt, trailing }: Props) {
  const base = presentSafetyState(state);

  // Standing inside a saved place is a normal, explained situation, not an
  // attention state — whatever the FSM was mid-transition when you arrived.
  const { headline, detail, color, marker, mode } = pausedAt
    ? {
        ...base,
        headline: `You're at ${pausedAt}.`,
        detail: "Checks are paused here. AURA picks up again when you leave.",
        color: colors.statusSafe,
        marker: "●",
        mode: "normal" as const,
      }
    : base;

  const loud = mode !== "normal";
  const reducedMotion = useReducedMotion();

  /**
   * One cue that the status moved, and nothing more.
   *
   * AURA_DESIGN.md section 24: a safety transition is immediate, the status
   * changes, the screen never flashes. So this is a single settle on the status
   * surface — the explanation fades down into place and the marker resolves
   * once. No pulse, no loop: a control that keeps moving during an emergency is
   * the thing section 40 asks about.
   */
  const settle = useRef(new Animated.Value(1)).current;
  const mounted = useRef(false);

  useEffect(() => {
    // Arriving on the journey screen is not a status change, so the first paint
    // is simply the status — already there, not sliding into place.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reducedMotion) {
      settle.setValue(1);
      return;
    }
    settle.setValue(0);
    Animated.timing(settle, {
      toValue: 1,
      duration: motion.component,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mode, reducedMotion, settle]);

  const enter = {
    opacity: settle,
    transform: [
      {
        translateY: settle.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }),
      },
    ],
  };

  return (
    <View
      style={[
        styles.container,
        loud && styles.loud,
        loud && { borderColor: color },
        mode === "critical" && styles.critical,
      ]}
    >
      <View style={styles.top}>
        {/* One accessibility node for the whole status, so it is read as a
            sentence rather than three fragments — but deliberately not
            `accessible` on the container, which would swallow the End button
            inside `trailing` and make it unreachable.

            No live region either: useJourneyMonitor already announces every
            state change on both platforms, and a live region here would say it
            twice on Android. */}
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${headline} ${detail}`}
          style={styles.textColumn}
        >
          <View style={styles.labelRow}>
            <Animated.Text style={[styles.marker, { color }, enter]}>
              {marker}
            </Animated.Text>
            <Text style={styles.label} numberOfLines={1}>
              {destination ? `To ${destination}` : "AURA"}
            </Text>
          </View>

          {/* Never truncated below three lines: "Your trusted contact has been
              notified." is the sentence that must survive a large font scale. */}
          <Text
            style={[styles.headline, loud && styles.headlineLoud]}
            numberOfLines={3}
          >
            {headline}
          </Text>
        </View>

        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>

      {/* Quiet when nothing is wrong: in `normal` the headline is the whole
          message, and the room goes to the evidence that AURA is still
          watching. Rule 7 — every warning explains why it happened — applies
          the moment it is not normal. */}
      {loud ? (
        <Animated.Text
          // Already inside the label above; announcing it again as its own stop
          // would read the explanation twice.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          // Capped so the banner has a ceiling. At a 200% font scale an
          // uncapped explanation could grow until it crowded the controls below
          // it, and on this screen the SOS winning that contest is not a close
          // call. Three lines fits both sentences at normal scale, and the
          // untruncated text still reaches a screen reader through the label
          // above and the speech channel in useJourneyMonitor.
          numberOfLines={3}
          style={[styles.detail, enter]}
        >
          {detail}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * A ruled band across the page, in every mode.
   *
   * The hairline underneath is the one piece of structure `normal` keeps: it
   * separates the verdict from the evidence below it without wrapping either in
   * a box, which is the Tokyo Metro / Swiss rail move — rules divide, cards do
   * not stack. `borderColor` rather than `borderBottomColor` on purpose, so the
   * status hue in `loud` overrides it instead of losing to the more specific
   * edge property.
   */
  container: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    gap: space.micro,
    paddingHorizontal: space.default,
    paddingVertical: space.compact,
  },
  /**
   * Only an attention or critical status becomes a surface, and it is a band
   * rather than a card: full bleed, ruled top and bottom. Section 37 asks for
   * quiet in normal use, so wrapping "You're on track." in a bordered box is a
   * card for its own sake — and an inset card would shift every line of text
   * sideways the moment something went wrong, which is movement that says
   * nothing. This way the words stay on the same 16px gutter in all three modes
   * and only the rules and the marker change.
   */
  loud: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    paddingVertical: space.default,
  },
  /** One heavier rule, not a thicker box. Signage, not a warning sticker. */
  critical: {
    borderTopWidth: 4,
  },
  top: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.compact,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
  labelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
  },
  marker: {
    fontSize: fontSize.meta,
  },
  label: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.meta,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headline: {
    color: colors.text,
    fontSize: fontSize.section,
    fontWeight: fontWeight.semibold,
    lineHeight: 27,
  },
  headlineLoud: {
    fontSize: fontSize.pageTitle,
    lineHeight: 38,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  trailing: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: space.tight,
  },
});
