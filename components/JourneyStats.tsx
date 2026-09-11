import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
import type { FixState } from "../hooks/useJourneyMonitor";

type Props = {
  fix: FixState;
  accuracyMeters: number | null;
};

/** Beyond this, fixes have stopped arriving and the traveller should know. */
const STALE_AFTER_SECONDS = 15;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * The same duration in words.
 *
 * "4:21" is read aloud as "four twenty-one" — a clock time, not an elapsed one.
 * Rounding to the minute also stops the spoken label churning once a second
 * while a screen reader is sitting on this row (AURA_DESIGN.md section 32: the
 * traveller must not be buried under machine-generated narration).
 */
function speakClock(totalSeconds: number): string {
  if (totalSeconds < 60) return "under a minute";
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minute${rest === 1 ? "" : "s"}`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function speakDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} metres`;
  return `${(meters / 1000).toFixed(2)} kilometres`;
}

type FixStatus = {
  /** What the row says on screen. */
  label: string;
  /** Why it says it — only when something is not normal (CLAUDE.md rule 7). */
  detail: string | null;
  /** Coarser wording for speech, so the label does not change every second. */
  spoken: string;
  live: boolean;
};

function describeFix(sinceFix: number | null, stale: boolean): FixStatus {
  if (sinceFix === null) {
    return {
      label: "Waiting for the first GPS fix",
      detail: "AURA does not have your position yet.",
      spoken: "Waiting for the first GPS fix",
      live: false,
    };
  }
  if (stale) {
    return {
      label: `No GPS for ${formatClock(sinceFix)}`,
      detail: "Your phone has not sent a new position.",
      spoken: `No GPS for ${speakClock(sinceFix)}`,
      live: false,
    };
  }
  if (sinceFix <= 2) {
    return { label: "Live", detail: null, spoken: "Live", live: true };
  }
  const label = `Updated ${sinceFix}s ago`;
  return { label, detail: null, spoken: label, live: true };
}

/**
 * Proof the journey is actually being tracked.
 *
 * The traveller this is built for cannot see the map, so this block — not the
 * map — is the reassurance that AURA is watching. It sits directly under the
 * safety status for that reason, and it leads with the one fact that decides
 * whether anything else on the screen can be believed: is a fix still arriving?
 * A monitoring app that has silently stopped receiving them looks exactly like
 * one that is working.
 *
 * The numbers underneath are AURA_DESIGN.md section 26's simple primitives — a
 * number and a label, never a chart — and they are deliberately set smaller
 * than the safety headline above them: this is evidence, not the verdict.
 *
 * Nothing here is a safety calculation. Fix freshness is a fact about this
 * phone's own sensor, not a judgement about the journey; deviation, inactivity
 * and risk all stay on the backend (CLAUDE.md rules 2 and 3).
 */
export function JourneyStats({ fix, accuracyMeters }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = fix.startedAt ? Math.floor((now - fix.startedAt) / 1000) : 0;
  const sinceFix = fix.lastFixAt ? Math.floor((now - fix.lastFixAt) / 1000) : null;
  const stale = sinceFix !== null && sinceFix > STALE_AFTER_SECONDS;
  const status = describeFix(sinceFix, stale);

  const updates = `${fix.count} update${fix.count === 1 ? "" : "s"}`;

  const stats = [
    {
      label: "Elapsed",
      value: formatClock(elapsed),
      spoken: `Elapsed ${speakClock(elapsed)}`,
    },
    {
      label: "Walked",
      value: formatDistance(fix.distanceMeters),
      spoken: `Walked ${speakDistance(fix.distanceMeters)}`,
    },
    {
      label: "GPS",
      value: accuracyMeters != null ? `±${Math.round(accuracyMeters)} m` : "—",
      // "±8 m" is read as a symbol soup; say what it means instead.
      spoken:
        accuracyMeters != null
          ? `GPS accurate to within ${Math.round(accuracyMeters)} metres`
          : "GPS accuracy not known yet",
    },
  ];

  return (
    <View style={styles.container}>
      {/* One stop for the whole tracking state, so a swipe answers "is AURA
          still watching?" in one sentence rather than three fragments. No live
          region: useJourneyMonitor already speaks the changes that matter, and
          a row that re-announces itself every second is the narration
          AURA_DESIGN.md section 32 exists to prevent. */}
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={[
          status.spoken,
          status.detail,
          `${fix.count} location updates sent.`,
        ]
          .filter((part): part is string => part !== null)
          .join(". ")}
        style={styles.liveRow}
      >
        {/* Shape as well as hue: filled when fixes are arriving, a hollow ring
            when they are not, and the words beside it say the same thing.
            Colour is never the only cue (CLAUDE.md rule 6), and the hue stays
            on the marker because statusAttention is 4.48:1 on surface — over
            the 3:1 floor for a graphic, under the 4.5:1 one for 13px text. */}
        <View style={[styles.dot, status.live ? styles.dotLive : styles.dotWaiting]} />
        <Text style={styles.liveLabel} numberOfLines={1}>
          {status.label}
        </Text>
        <Text style={styles.count} numberOfLines={1}>
          {updates}
        </Text>
      </View>

      {/* Already inside the label above; reading it twice is noise. */}
      {status.detail ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.detail}
        >
          {status.detail}
        </Text>
      ) : null}

      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={stats.map((stat) => stat.spoken).join(". ")}
        style={styles.row}
      >
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Text style={styles.value} numberOfLines={1}>
              {stat.value}
            </Text>
            <Text style={styles.label} numberOfLines={1}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * A ruled block on the page ground, not a raised card: 1px border, no
   * shadow, no second surface inside it (CLAUDE.md rules 4 and 5).
   */
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space.tight,
    paddingHorizontal: space.compact,
    paddingVertical: space.compact,
  },
  liveRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.tight,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  dotLive: {
    backgroundColor: colors.statusSafe,
  },
  dotWaiting: {
    borderColor: colors.statusAttention,
    borderWidth: 2,
  },
  liveLabel: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  count: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
  },
  detail: {
    // Not textMuted: #8A8A84 on surface is 3.47:1, under AA for 13px text.
    color: colors.textSecondary,
    fontSize: fontSize.meta,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
  },
  stat: {
    flex: 1,
  },
  /**
   * One step below the safety headline on purpose. Three 22px numbers sitting
   * under a 22px "You're on track." made the evidence compete with the verdict.
   */
  value: {
    color: colors.text,
    fontSize: fontSize.cardTitle,
    fontWeight: fontWeight.semibold,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.meta,
  },
});
