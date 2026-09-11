import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the traveller has asked the system for less movement.
 *
 * AURA_DESIGN.md section 30 lists reduced-motion support as a requirement, and
 * section 40 asks whether motion could distract during a safety event. For
 * someone with a vestibular disorder the honest answer is yes, so every
 * animation in the app reads this and falls back to an instant change rather
 * than a shorter one.
 *
 * It starts at `true`, which is the whole point. `isReduceMotionEnabled()` is a
 * promise, so a hook that started at `false` would report "motion is fine" for
 * the first render or two — and the first render is exactly when a screen
 * mounts and every entrance animation fires. Someone who had already turned the
 * setting on would see the one animation they asked not to see. Assuming
 * reduced until told otherwise costs everyone else a few milliseconds of no
 * animation, which is nothing, and costs them nothing at all on a state change
 * later in the journey.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let active = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });

    // The setting can be turned on mid-journey, which is exactly when somebody
    // who needs it would reach for it.
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => setReduced(value),
    );

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
