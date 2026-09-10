/**
 * Spoken output.
 *
 * AURA_DESIGN.md section 32: the traveller should never be buried under
 * machine-generated narration. Announcements carry a priority; a lower-priority
 * line is dropped while a more urgent one is still being spoken, and repeating
 * the same line is suppressed for a short window.
 */

import * as Speech from "expo-speech";

export type AudioPriority = "hazard" | "navigation" | "environment" | "requested";

const RANK: Record<AudioPriority, number> = {
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

export function speak(text: string, priority: AudioPriority = "environment"): void {
  if (!enabled || !text.trim()) return;

  const now = Date.now();
  const previous = lastSpokenAt.get(text);
  if (previous !== undefined && now - previous < REPEAT_SUPPRESSION_MS) return;

  // Something more urgent is already being said.
  if (speakingPriority !== null && RANK[priority] < RANK[speakingPriority]) return;

  // Something less urgent is being said and this outranks it.
  if (speakingPriority !== null && RANK[priority] > RANK[speakingPriority]) {
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
}

/** Say something even if it was just said — used when a check-in is re-prompted. */
export function speakUrgent(text: string): void {
  lastSpokenAt.delete(text);
  speak(text, "hazard");
}

export function stopSpeaking(): void {
  void Speech.stop();
  speakingPriority = null;
}
