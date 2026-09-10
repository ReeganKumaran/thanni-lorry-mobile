import { useCallback, useEffect, useRef, useState } from "react";

import { tapFeedback, activatedFeedback, cancelledFeedback } from "../services/haptics";
import { speak, speakUrgent, stopSpeaking } from "../services/speech";
import {
  isVoiceInputSupported,
  listenOnce,
  parseIntent,
  requestVoicePermission,
} from "../services/voice";
import type { VoiceIntent, VoiceSession } from "../services/voice";

export type VoiceHandlers = {
  onSafe?: () => void;
  onHelp?: () => void;
  onStart?: (destination: string) => void;
  onStop?: () => void;
  /** "What's in front of me?" — asks the edge node for a description now. */
  onLookAhead?: () => void;
  /** Should return a short spoken answer, per AURA_DESIGN.md section 31. */
  describeLocation?: () => string;
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
  const handlersRef = useRef(handlers);

  handlersRef.current = handlers;

  useEffect(() => {
    return () => sessionRef.current?.stop();
  }, []);

  const say = useCallback((line: string) => {
    lastAnswerRef.current = line;
    speakUrgent(line);
  }, []);

  const dispatch = useCallback(
    (intent: VoiceIntent) => {
      const h = handlersRef.current;
      switch (intent.kind) {
        case "help":
          activatedFeedback();
          say("I'm here. I'm notifying your trusted contact now.");
          h.onHelp?.();
          return;
        case "safe":
          say("Okay. I'll keep monitoring your journey.");
          h.onSafe?.();
          return;
        case "where":
          say(h.describeLocation?.() ?? "I don't know where you are yet.");
          return;
        case "start":
          say(`Starting a monitored journey to ${intent.destination}.`);
          h.onStart?.(intent.destination);
          return;
        case "stop":
          say("Okay. I've stopped monitoring.");
          h.onStop?.();
          return;
        case "lookAhead":
          if (h.onLookAhead) {
            say("Looking.");
            h.onLookAhead();
          } else {
            say("The camera isn't watching right now.");
          }
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
    [say],
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
        (transcript) => {
          setListening(false);
          setLastHeard(transcript);
          dispatch(parseIntent(transcript));
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
