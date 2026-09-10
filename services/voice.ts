/**
 * Voice input.
 *
 * AURA is built for people who cannot read the screen, so speech is a primary
 * control surface, not a convenience. AURA_DESIGN.md section 31 sets the tone:
 * short, conversational, never a robotic status dump.
 *
 * Recognition runs on the device where the platform supports it — a journey
 * monitor should not need the network to hear "I need help", and what the
 * traveller says on a walk is not ours to ship anywhere.
 */

import { requireOptionalNativeModule } from "expo";

/** What the traveller asked for. */
export type VoiceIntent =
  | { kind: "safe" }
  | { kind: "help" }
  | { kind: "where" }
  | { kind: "start"; destination: string }
  | { kind: "stop" }
  | { kind: "repeat" }
  | { kind: "unknown"; transcript: string };

type Recognition = typeof import("expo-speech-recognition");

let recognitionModule: Recognition | null | undefined;

/**
 * Loaded lazily and probed first — a static import of a missing native module
 * throws at evaluation time and takes the whole screen down with it. The same
 * trap expo-av set earlier.
 */
function loadRecognition(): Recognition | null {
  if (recognitionModule !== undefined) return recognitionModule;

  if (requireOptionalNativeModule("ExpoSpeechRecognition") == null) {
    recognitionModule = null;
    return recognitionModule;
  }

  try {
    recognitionModule = require("expo-speech-recognition") as Recognition;
  } catch {
    recognitionModule = null;
  }
  return recognitionModule;
}

export function isVoiceInputSupported(): boolean {
  return loadRecognition() !== null;
}

export async function requestVoicePermission(): Promise<boolean> {
  const mod = loadRecognition();
  if (!mod) return false;
  try {
    const result = await mod.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted === true;
  } catch {
    return false;
  }
}

export type VoiceSession = {
  stop: () => void;
};

/**
 * One heard utterance.
 *
 * `confidence` follows the platform's convention: -1 means the recognizer did
 * not report one, and 0 is what a partial result carries. Neither is the same
 * as "certainly wrong", so callers must treat them as *unknown* rather than as
 * a low score — dropping everything a device cannot score would disable voice
 * entirely on that device.
 */
export type VoiceResult = {
  transcript: string;
  confidence: number;
  /** Lower-ranked hypotheses, best first. In noise the right one is often here. */
  alternatives: string[];
  /** True when this came from a partial the recognizer never finalised. */
  fromPartial: boolean;
};

/** Confidence at or above which a benign command is acted on. */
export const MIN_CONFIDENCE_BENIGN = 0.3;

/**
 * Confidence at or above which "I need help" escalates without asking first.
 *
 * Below it AURA does NOT discard the request — it asks. Silently ignoring
 * someone who said they need help is a far worse failure than a confirmation
 * step, and silently escalating on a misheard word has its own cost, so the
 * uncertain middle gets a question rather than a guess either way.
 */
export const MIN_CONFIDENCE_HELP = 0.6;

/** Intents where acting wrongly notifies a trusted contact and opens an incident. */
export function isSafetyCritical(kind: VoiceIntent["kind"]): boolean {
  return kind === "help";
}

/**
 * Listen for one utterance. `onResult` fires once with the final transcript;
 * `onError` fires if the platform gives up. Returns a handle to stop early.
 */
export function listenOnce(
  onResult: (result: VoiceResult) => void,
  onError: (message: string) => void,
): VoiceSession | null {
  const mod = loadRecognition();
  if (!mod) {
    onError("Voice control needs a rebuild of the app.");
    return null;
  }

  const { ExpoSpeechRecognitionModule } = mod;
  let finished = false;
  let bestPartial = "";
  const subscriptions: { remove: () => void }[] = [];

  const cleanup = () => {
    subscriptions.forEach((s) => {
      try {
        s.remove();
      } catch {
        // Already removed.
      }
    });
    subscriptions.length = 0;
  };

  const finish = (result: VoiceResult | null, error?: string) => {
    if (finished) return;
    finished = true;
    cleanup();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }
    if (result !== null) onResult(result);
    else onError(error ?? "I didn't catch that.");
  };

  try {
    // Listeners go on the native module itself, never through the package's
    // `addSpeechRecognitionListener` re-export. That export is the JSI host
    // method torn off its object (`export const addSpeechRecognitionListener =
    // ExpoSpeechRecognitionModule.addListener`), so the receiver is whatever
    // you happen to call it on. Called as `mod.addSpeechRecognitionListener(…)`
    // it quietly subscribes to the module namespace object instead of the
    // native emitter: registration succeeds, nothing throws, and not one event
    // ever arrives — the app sits on "Listening…" for ever while the recognizer
    // has already returned a transcript. Called bare it aborts the process
    // outright ("jsi::Value::getObject: assertion isObject() failed").
    // Both were reproduced on the device.
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("result", (event) => {
        const results = event.results ?? [];
        const best = results[0]?.transcript?.trim() ?? "";
        if (!best) return;

        if (!event.isFinal) {
          // Keep the last partial. On Android a noisy session frequently ends
          // without ever producing a final result, and throwing the partial
          // away is why "I need help" shouted at a junction used to come back
          // as "I didn't catch that".
          bestPartial = best;
          return;
        }

        finish({
          transcript: best,
          confidence: results[0]?.confidence ?? -1,
          alternatives: results.slice(1).map((r) => r.transcript?.trim() ?? ""),
          fromPartial: false,
        });
      }),
    );
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("error", (event) => {
        // A partial we already heard beats an apology, even if the session
        // then errored — but not for no-speech, where there is nothing to use.
        if (bestPartial && event.error !== "no-speech") {
          finish({
            transcript: bestPartial,
            confidence: -1,
            alternatives: [],
            fromPartial: true,
          });
          return;
        }
        finish(null, describeError(event.error));
      }),
    );
    subscriptions.push(
      ExpoSpeechRecognitionModule.addListener("end", () => {
        if (finished) return;
        if (bestPartial) {
          finish({
            transcript: bestPartial,
            confidence: -1,
            alternatives: [],
            fromPartial: true,
          });
          return;
        }
        finish(null, "I didn't catch that.");
      }),
    );

    ExpoSpeechRecognitionModule.start({
      lang: "en-IN",
      // Partials are the safety net for the case above.
      interimResults: true,
      continuous: false,
      // Falls back to the platform service when on-device is unavailable.
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
      // The command vocabulary is tiny and fixed, so telling the recognizer
      // what it is likely to hear is the cheapest accuracy AURA can buy —
      // EXTRA_BIASING_STRINGS on Android 33+, contextualStrings on iOS.
      contextualStrings: VOICE_BIASING_PHRASES,
      // Ask for alternatives: in noise the correct reading is often ranked
      // second or third, and the grammar can recognise it when the top one is
      // nonsense.
      maxAlternatives: 5,
      androidIntentOptions: {
        // Street noise makes the recognizer call end-of-speech early, cutting
        // "I need help" down to "I need". Give a spoken phrase room to finish.
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1500,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1200,
        EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1000,
      },
    });
  } catch {
    finish(null, "Voice control could not start.");
    return null;
  }

  return {
    stop: () => finish(null, "Cancelled."),
  };
}

function describeError(code: string | undefined): string {
  switch (code) {
    case "no-speech":
      return "I didn't hear anything.";
    case "not-allowed":
    case "service-not-allowed":
      return "AURA needs microphone permission to listen.";
    case "network":
      return "Voice recognition needs a connection right now.";
    default:
      return "I didn't catch that.";
  }
}

// =============================================================================
// Command grammar
// =============================================================================

/**
 * Match what people actually say, not a command syntax they have to learn.
 * AURA_DESIGN.md section 31 uses "I'm safe", "I need help", "Where am I?" —
 * these are the phrasings, plus the obvious neighbours.
 */
const PATTERNS: { kind: VoiceIntent["kind"]; tests: RegExp[] }[] = [
  {
    kind: "help",
    tests: [/\bhelp\b/, /\bemergency\b/, /\bsos\b/, /\bnot safe\b/, /\bin danger\b/],
  },
  {
    kind: "safe",
    tests: [
      /\bi(?:'m| am)? ?(?:safe|okay|ok|fine|alright)\b/,
      /\ball good\b/,
      /\bno problem\b/,
    ],
  },
  {
    kind: "where",
    tests: [/\bwhere am i\b/, /\bwhere are we\b/, /\bmy location\b/, /\bhow far\b/],
  },
  {
    kind: "stop",
    tests: [/\b(?:stop|end|finish|cancel) (?:the )?(?:journey|trip|monitoring)\b/, /\bi(?:'ve| have)? arrived\b/],
  },
  { kind: "repeat", tests: [/\b(?:repeat|say (?:that )?again|what did you say)\b/] },
];

/** "take me to college", "start journey to home", "go to the station" */
const START_PATTERNS = [
  /\b(?:take me|walk me|navigate|go|head)(?: me)? to (?:the )?(.+)$/,
  /\bstart (?:a )?(?:journey|trip)(?: to)? (?:the )?(.+)$/,
  /\bjourney to (?:the )?(.+)$/,
];

/**
 * What AURA is likely to hear, handed to the recognizer as biasing.
 *
 * These are the phrasings the grammar below actually matches, written out in
 * full. The vocabulary is tiny and fixed, which is exactly the situation
 * biasing is for: on a noisy street "I need help" competes with every other
 * English phrase unless the recognizer is told it is expected.
 */
export const VOICE_BIASING_PHRASES: string[] = [
  "I need help",
  "help",
  "emergency",
  "SOS",
  "I am not safe",
  "I'm in danger",
  "I'm safe",
  "I am okay",
  "all good",
  "where am I",
  "how far",
  "stop the journey",
  "end the journey",
  "I have arrived",
  "say that again",
  "take me to home",
  "take me to work",
  "start a journey",
  "yes",
  "no",
];

/** "yes", said the many ways people say it. Used to confirm an uncertain SOS. */
const AFFIRMATIVE = /\b(?:yes|yeah|yep|yup|correct|right|confirm|do it|please do)\b/;
const NEGATIVE = /\b(?:no|nope|cancel|never mind|nevermind|stop|wrong)\b/;

export function isAffirmative(transcript: string): boolean {
  const t = transcript.toLowerCase();
  return AFFIRMATIVE.test(t) && !NEGATIVE.test(t);
}

export function isNegative(transcript: string): boolean {
  return NEGATIVE.test(transcript.toLowerCase());
}

/**
 * Read the intent from the best hypothesis, falling back to the alternatives.
 *
 * The recognizer ranks by acoustic likelihood, not by what this app can act on.
 * In noise the top line is regularly nonsense while the second or third is the
 * command that was actually spoken, so a hypothesis that matches the grammar
 * beats a higher-ranked one that matches nothing. Order is preserved, so the
 * best matching hypothesis still wins.
 */
export function parseBestIntent(result: {
  transcript: string;
  alternatives: string[];
}): { intent: VoiceIntent; matched: string } {
  const candidates = [result.transcript, ...result.alternatives].filter(
    (c) => c && c.trim().length > 0,
  );

  for (const candidate of candidates) {
    const intent = parseIntent(candidate);
    if (intent.kind !== "unknown") return { intent, matched: candidate };
  }
  return {
    intent: { kind: "unknown", transcript: result.transcript },
    matched: result.transcript,
  };
}

export function parseIntent(rawTranscript: string): VoiceIntent {
  const transcript = rawTranscript.toLowerCase().trim().replace(/[.?!]+$/, "");

  // Help wins over everything: never let a longer phrase swallow a plea.
  for (const { kind, tests } of PATTERNS) {
    if (tests.some((t) => t.test(transcript))) {
      return { kind } as VoiceIntent;
    }
  }

  for (const pattern of START_PATTERNS) {
    const match = transcript.match(pattern);
    const destination = match?.[1]?.trim();
    if (destination) return { kind: "start", destination };
  }

  return { kind: "unknown", transcript: rawTranscript.trim() };
}
