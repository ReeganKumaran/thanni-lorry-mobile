/**
 * Haptic feedback.
 *
 * The SOS hold is the one control a traveller may need to use without looking,
 * so each stage has its own distinct feel: a light tap on contact, a firmer
 * pulse per second as the hold builds, and an unmistakable notification burst
 * on activation.
 *
 * Every call is fire-and-forget and swallows its errors — a device with no
 * haptic motor, or one where the user has turned them off, must never break
 * the action the feedback accompanies.
 */

import * as Haptics from "expo-haptics";

function safely(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => {});
  } catch {
    // No haptic engine on this device.
  }
}

/** Finger has landed on a control. */
export function tapFeedback(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** One second of a hold has elapsed; firmer than the last. */
export function holdTickFeedback(): void {
  safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** The action fired. Unmistakable, and different from every tick. */
export function activatedFeedback(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Released before the hold completed; nothing happened. */
export function cancelledFeedback(): void {
  safely(() => Haptics.selectionAsync());
}

/** A safety check is waiting for an answer. */
export function alertFeedback(): void {
  safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
