import { useCallback, useEffect, useRef, useState } from "react";

import { tapFeedback, activatedFeedback, cancelledFeedback } from "../services/haptics";
import { speak, speakUrgent, stopSpeaking } from "../services/speech";
import {
  MIN_CONFIDENCE_BENIGN,
  MIN_CONFIDENCE_HELP,
  isAffirmative,
  isNegative,
  isSafetyCritical,
  isVoiceInputSupported,
  listenOnce,
  parseBestIntent,
  requestVoicePermission,
} from "../services/voice";
import type { VoiceIntent, VoiceResult, VoiceSession } from "../services/voice";

export type VoiceHandlers = {
  onSafe?: () => void;
  onHelp?: () => void;
  onStart?: (destination: string) => void;
  onStop?: () => void;
  /** Should return a short spoken answer, per AURA_DESIGN.md section 31. */
  describeLocation?: () => string;
  /** Look at the ground ahead now and say what is there. */
  onScan?: () => void;
};

export type VoiceControl = {
  supported: boolean;
  listening: boolean;
  /** What AURA last heard, so a sighted helper can see it went wrong. */
  lastHeard: string | null;
  listen: () => void;
};

/**
 * Speech as a control surface.
 *
 * Everything is answered out loud, because the traveller may not be able to
 * read the reply. Answers stay to a sentence: section 31 asks for
 * conversational, not a status dump.
 */
export function useVoiceControl(handlers: VoiceHandlers): VoiceControl {
  const [listening, setListening] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const lastAnswerRef = useRef<string>("");
  // Set when AURA has asked "did you say you need help?" and is waiting.
  const awaitingHelpConfirmationRef = useRef(false);
  const handlersRef = useRef(handlers);

  handlersRef.current = handlers;

  useEffect(() => {
    return () => sessionRef.current?.stop();
  }, []);

  const say = useCallback((line: string) => {
    lastAnswerRef.current = line;
    speakUrgent(line);
  }, []);

  /** Raise the SOS, saying so first. Split out so the confirm path can reuse it. */
  const raiseHelp = useCallback(
    (onHelp: () => void) => {
      awaitingHelpConfirmationRef.current = false;
      activatedFeedback();
      say("I'm here. I'm notifying your trusted contact now.");
      onHelp();
    },
    [say],
  );

  const dispatch = useCallback(
    (intent: VoiceIntent, result: VoiceResult) => {
      const h = handlersRef.current;
      const confidence = result.confidence;
      // -1 means the recognizer did not score this one and 0 is what a partial
      // carries. Neither says the words were wrong, so they are "unknown", not
      // "low" — treating them as low would mute voice control entirely on a
      // device that never reports a score.
      const scored = confidence >= 0;

      // An answer to "did you say you need help?".
      if (awaitingHelpConfirmationRef.current) {
        awaitingHelpConfirmationRef.current = false;
        if (intent.kind === "help" || isAffirmative(result.transcript)) {
          if (h.onHelp) {
            raiseHelp(h.onHelp);
            return;
          }
        }
        if (isNegative(result.transcript)) {
          say("Okay, I won't call anyone.");
          return;
        }
        // Anything else: fall through and treat it as a fresh command.
      }

      // Benign commands are dropped when the recognizer says it is unsure —
      // the cost is that the traveller repeats themselves, which is nothing.
      if (
        intent.kind !== "unknown" &&
        !isSafetyCritical(intent.kind) &&
        scored &&
        confidence < MIN_CONFIDENCE_BENIGN
      ) {
        say("I didn't quite catch that. Say it again?");
        return;
      }

      // Each screen supplies only the handlers it can honour: the home screen
      // has no journey to escalate, the journey screen has no second one to
      // start. Every branch checks before it speaks, because the answer is the
      // only feedback a traveller who cannot see the screen gets. Announcing
      // "I'm notifying your trusted contact" with nothing behind it is the
      // worst thing AURA could say to someone who has just asked for help.
      switch (intent.kind) {
        case "help": {
          if (!h.onHelp) {
            say("I can't call for help until a journey is running. Say: take me to home.");
            return;
          }
          // Confident enough to act on its own.
          if (scored && confidence >= MIN_CONFIDENCE_HELP) {
            raiseHelp(h.onHelp);
            return;
          }
          // Not confident enough to escalate on, and far too important to
          // throw away. Ask. A misheard word costs one question; an ignored
          // plea costs everything this product exists to prevent.
          awaitingHelpConfirmationRef.current = true;
          say("Did you say you need help? Say yes, or hold the red button.");
          return;
        }
        case "safe":
          if (!h.onSafe) {
            say("Nothing is being monitored right now.");
            return;
          }
          say("Okay. I'll keep monitoring your journey.");
          h.onSafe();
          return;
        case "where":
          say(h.describeLocation?.() ?? "I don't know where you are yet.");
          return;
        case "scan":
          if (!h.onScan) {
            say("I can only look at the path while a journey is running.");
            return;
          }
          // The scan answers out loud itself, including when it finds nothing,
          // so there is nothing to say here beyond starting it.
          h.onScan();
          return;
        case "start":
          if (!h.onStart) {
            say("You're already on a journey. Say: stop the journey, to end it first.");
            return;
          }
          say(`Starting a monitored journey to ${intent.destination}.`);
          h.onStart(intent.destination);
          return;
        case "stop":
          if (!h.onStop) {
            say("There's no journey to stop.");
            return;
          }
          say("Okay. I've stopped monitoring.");
          h.onStop();
          return;
        case "repeat":
          speakUrgent(lastAnswerRef.current || "I haven't said anything yet.");
          return;
        default:
          say(
            "I didn't understand. You can say: I'm safe, I need help, where am I, or take me to home.",
          );
      }
    },
    [raiseHelp, say],
  );

  const listen = useCallback(() => {
    if (listening) {
      sessionRef.current?.stop();
      return;
    }

    void (async () => {
      if (!isVoiceInputSupported()) {
        speak("Voice control needs a rebuild of the app.", "requested");
        return;
      }

      const granted = await requestVoicePermission();
      if (!granted) {
        speak("AURA needs microphone permission to listen.", "requested");
        return;
      }

      // Our own voice would otherwise be the first thing it hears.
      stopSpeaking();
      tapFeedback();
      setListening(true);

      sessionRef.current = listenOnce(
        (result) => {
          setListening(false);
          const { intent, matched } = parseBestIntent(result);
          // Show what was acted on, not just the top hypothesis — otherwise a
          // sighted helper sees nonsense next to a command that worked.
          setLastHeard(matched);
          dispatch(intent, result);
        },
        (message) => {
          setListening(false);
          cancelledFeedback();
          speak(message, "requested");
        },
      );
    })();
  }, [dispatch, listening]);

  return {
    supported: isVoiceInputSupported(),
    listening,
    lastHeard,
    listen,
  };
}
