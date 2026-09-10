/**
 * User-facing language for safety states.
 *
 * AURA_DESIGN.md section 11: do not expose the whole state machine to the
 * traveller. The technical state stays in the trusted-contact console.
 */

import type { SafetyState } from "@aura/types";

import { colors } from "./theme";

type SafetyPresentation = {
  /** Short line shown in the status banner. */
  headline: string;
  /** One sentence of plain-language context, spoken and displayed. */
  detail: string;
  color: string;
  /** Non-colour cue, so status is never communicated by colour alone. */
  marker: string;
};

const PRESENTATION: Record<SafetyState, SafetyPresentation> = {
  SAFE: {
    headline: "You're on track.",
    detail: "AURA is monitoring your journey.",
    color: colors.statusSafe,
    marker: "●",
  },
  UNUSUAL: {
    headline: "Your route has changed.",
    detail: "AURA is watching to see whether this is intentional.",
    color: colors.statusAttention,
    marker: "▲",
  },
  UNCERTAIN: {
    headline: "AURA is checking on something.",
    detail: "Your movement doesn't match the planned journey.",
    color: colors.statusAttention,
    marker: "▲",
  },
  CHECKING: {
    headline: "Are you safe?",
    detail: "AURA is waiting for your answer.",
    color: colors.statusInfo,
    marker: "?",
  },
  RESOLVED: {
    headline: "You're on track.",
    detail: "AURA is monitoring your journey.",
    color: colors.statusSafe,
    marker: "●",
  },
  HIGH_RISK: {
    headline: "AURA needs your attention.",
    detail: "Answer the safety check so your contact isn't alerted.",
    color: colors.statusRisk,
    marker: "■",
  },
  ESCALATED: {
    headline: "Your trusted contact has been notified.",
    detail: "Help is being arranged. Stay where you are if you can.",
    color: colors.statusRisk,
    marker: "■",
  },
};

export function presentSafetyState(state: SafetyState): SafetyPresentation {
  return PRESENTATION[state] ?? PRESENTATION.SAFE;
}

/** States that mean AURA is actively waiting on the traveller. */
export function isAwaitingResponse(state: SafetyState): boolean {
  return state === "CHECKING";
}
