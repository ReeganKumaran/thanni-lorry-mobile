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
  | { kind: "lookAhead" }
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
 * Listen for one utterance. `onResult` fires once with the final transcript;
 * `onError` fires if the platform gives up. Returns a handle to stop early.
 */
export function listenOnce(
  onResult: (transcript: string) => void,
  onError: (message: string) => void,
): VoiceSession | null {
  const mod = loadRecognition();
  if (!mod) {
    onError("Voice control needs a rebuild of the app.");
    return null;
  }

  const { ExpoSpeechRecognitionModule } = mod;
  let finished = false;
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

  const finish = (transcript: string | null, error?: string) => {
    if (finished) return;
    finished = true;
    cleanup();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }
    if (transcript !== null) onResult(transcript);
    else onError(error ?? "I didn't catch that.");
  };

  try {
    subscriptions.push(
      mod.addSpeechRecognitionListener("result", (event) => {
        const best = event.results?.[0]?.transcript ?? "";
        if (event.isFinal && best.trim()) finish(best.trim());
      }),
    );
    subscriptions.push(
      mod.addSpeechRecognitionListener("error", (event) =>
        finish(null, describeError(event.error)),
      ),
    );
    subscriptions.push(
      mod.addSpeechRecognitionListener("end", () => {
        // Ended without a final result: nothing was understood.
        if (!finished) finish(null, "I didn't catch that.");
      }),
    );

    ExpoSpeechRecognitionModule.start({
      lang: "en-IN",
      interimResults: false,
      continuous: false,
      // Falls back to the platform service when on-device is unavailable.
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
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
  {
    kind: "lookAhead",
    tests: [
      /\bwhat(?:'s| is)? (?:in front|ahead)\b/,
      /\bwhat(?:'s| is)? (?:there|around)\b/,
      /\blook ahead\b/,
      /\bdescribe\b/,
    ],
  },
];

/** "take me to college", "start journey to home", "go to the station" */
const START_PATTERNS = [
  /\b(?:take me|walk me|navigate|go|head)(?: me)? to (?:the )?(.+)$/,
  /\bstart (?:a )?(?:journey|trip)(?: to)? (?:the )?(.+)$/,
  /\bjourney to (?:the )?(.+)$/,
];

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
