/**
 * Spoken output.
 *
 * AURA_DESIGN.md section 32: the traveller should never be buried under
 * machine-generated narration. Announcements carry a priority; a lower-priority
 * line is dropped while a more urgent one is still being spoken, and repeating
 * the same line is suppressed for a short window.
 */

import * as Speech from "expo-speech";

/**
 * `safety` sits above `hazard` on purpose. AURA_DESIGN.md section 32 orders the
 * environment ladder — hazard beats navigation beats environment — but the
 * safety conversation itself is not part of that ladder: "Are you safe?" and
 * "I'm notifying your trusted contact now" must never be talked over by a
 * remark about the pavement. Before the camera existed, `hazard` was only ever
 * produced by the app's own sequential safety logic so the two could not
 * collide; now that perception speaks too, they need separate ranks.
 */
export type AudioPriority =
  | "safety"
  | "hazard"
  | "navigation"
  | "environment"
  | "requested";

const RANK: Record<AudioPriority, number> = {
  safety: 5,
  hazard: 4,
  navigation: 3,
  environment: 2,
  requested: 1,
};

/** A line worth repeating after this long, but not before. */
const REPEAT_SUPPRESSION_MS = 20_000;

const SPEECH_OPTIONS: Speech.SpeechOptions = {
  language: "en-US",
  rate: 1.0,
  pitch: 1.0,
};

let enabled = true;
let speakingPriority: AudioPriority | null = null;
const lastSpokenAt = new Map<string, number>();

export function setVoiceGuidanceEnabled(next: boolean): void {
  enabled = next;
  if (!next) void Speech.stop();
}

export function isVoiceGuidanceEnabled(): boolean {
  return enabled;
}

/**
 * What became of a request to speak.
 *
 * Callers that de-duplicate their own announcements need this. A caller that
 * marks a line "said" when it was actually dropped will never offer it again —
 * and for turn-by-turn guidance that means a traveller relying on audio simply
 * never hears a turn, with nothing to indicate anything went wrong.
 *
 *   spoken     an utterance started
 *   duplicate  identical text was said moments ago, so they have heard it
 *   outranked  something more urgent held the floor — worth trying again
 *   disabled   voice guidance is switched off, or there was nothing to say
 */
export type SpeechOutcome = "spoken" | "duplicate" | "outranked" | "disabled";

export function speak(
  text: string,
  priority: AudioPriority = "environment",
): SpeechOutcome {
  if (!enabled || !text.trim()) return "disabled";

  const now = Date.now();
  const previous = lastSpokenAt.get(text);
  if (previous !== undefined && now - previous < REPEAT_SUPPRESSION_MS) {
    return "duplicate";
  }

  if (speakingPriority !== null) {
    // Something more urgent is already being said.
    if (RANK[priority] < RANK[speakingPriority]) return "outranked";
    // Equal or higher: take the floor. Equal used to fall through and start a
    // second utterance without stopping the first, which left the platform to
    // decide whether to queue, overlap or truncate — not a choice worth
    // leaving to chance between two safety lines.
    void Speech.stop();
  }

  lastSpokenAt.set(text, now);
  speakingPriority = priority;

  Speech.speak(text, {
    ...SPEECH_OPTIONS,
    onDone: () => {
      speakingPriority = null;
    },
    onStopped: () => {
      speakingPriority = null;
    },
    onError: () => {
      speakingPriority = null;
    },
  });

  return "spoken";
}

/**
 * The safety conversation: check-ins, SOS confirmations, the hold prompt.
 * Said even if it was just said, and outranks everything else.
 */
export function speakUrgent(text: string): SpeechOutcome {
  lastSpokenAt.delete(text);
  return speak(text, "safety");
}

export function stopSpeaking(): void {
  void Speech.stop();
  speakingPriority = null;
}
