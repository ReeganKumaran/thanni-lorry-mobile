/**
 * User-facing language for safety states.
 *
 * AURA_DESIGN.md section 11: do not expose the whole state machine to the
 * traveller. The technical state stays in the trusted-contact console.
 */

import type { SafetyState } from "@aura/types";

import { colors } from "./theme";

/**
 * How loud the screen should be (AURA_DESIGN.md section 37).
 *
 * The doc asks for three visual modes rather than one layout that only swaps a
 * colour: `normal` is quiet and map-first, `attention` shows a stronger status
 * with its explanation, `critical` is high-contrast and puts the current action
 * in front of everything else.
 *
 * This is presentation mapped from the state the backend already decided, which
 * is what AURA_DESIGN.md section 41 describes. It is not a severity calculation:
 * nothing here reads `deviation_meters`, `inactivity_seconds` or any raw event,
 * and the mode cannot change unless the FSM moved first.
 */
export type StatusMode = "normal" | "attention" | "critical";

type SafetyPresentation = {
  /** Short line shown in the status banner. */
  headline: string;
  /** One sentence of plain-language context, spoken and displayed. */
  detail: string;
  color: string;
  /** Non-colour cue, so status is never communicated by colour alone. */
  marker: string;
  mode: StatusMode;
};

const PRESENTATION: Record<SafetyState, SafetyPresentation> = {
  SAFE: {
    headline: "You're on track.",
    detail: "AURA is monitoring your journey.",
    color: colors.statusSafe,
    marker: "●",
    mode: "normal",
  },
  UNUSUAL: {
    headline: "Your route has changed.",
    detail: "AURA is watching to see whether this is intentional.",
    color: colors.statusAttention,
    marker: "▲",
    mode: "attention",
  },
  UNCERTAIN: {
    headline: "AURA is checking on something.",
    detail: "Your movement doesn't match the planned journey.",
    color: colors.statusAttention,
    marker: "▲",
    mode: "attention",
  },
  CHECKING: {
    headline: "Are you safe?",
    detail: "AURA is waiting for your answer.",
    color: colors.statusInfo,
    marker: "?",
    mode: "attention",
  },
  RESOLVED: {
    headline: "You're on track.",
    detail: "AURA is monitoring your journey.",
    color: colors.statusSafe,
    marker: "●",
    mode: "normal",
  },
  HIGH_RISK: {
    headline: "AURA needs your attention.",
    detail: "Answer the safety check so your contact isn't alerted.",
    color: colors.statusRisk,
    marker: "■",
    mode: "critical",
  },
  ESCALATED: {
    headline: "Your trusted contact has been notified.",
    detail: "Help is being arranged. Stay where you are if you can.",
    color: colors.statusRisk,
    marker: "■",
    mode: "critical",
  },
};

export function presentSafetyState(state: SafetyState): SafetyPresentation {
  return PRESENTATION[state] ?? PRESENTATION.SAFE;
}

/** States that mean AURA is actively waiting on the traveller. */
export function isAwaitingResponse(state: SafetyState): boolean {
  return state === "CHECKING";
}
