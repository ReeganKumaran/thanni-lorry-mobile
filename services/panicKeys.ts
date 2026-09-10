/**
 * The silent panic gesture: volume-down pressed five times quickly.
 *
 * The on-screen hold sounds an alarm on purpose, which is the wrong tool when
 * being heard is itself the danger. This path raises the same SOS without a
 * sound, without a countdown, and without the screen showing anything — it can
 * be done one-handed, in a pocket, or while someone else is watching the phone.
 *
 * It used to be both volume keys held together. Android reserves that chord for
 * its own accessibility shortcut and consumes it before any app sees it, so the
 * gesture never fired once. See plugins/withPanicVolumeKeys.js for the evidence
 * and for the native half of this.
 *
 * Android only: iOS gives apps no supported way to intercept the volume keys.
 * The keys also only reach the app while it is foregrounded and focused, so
 * this is not a screen-off panic button.
 */

import { DeviceEventEmitter, Platform } from "react-native";
import type { EmitterSubscription } from "react-native";

const EVENT = "auraPanicVolumeKeys";

/** True where the gesture can work at all. */
export const isPanicGestureSupported = Platform.OS === "android";

/**
 * How to perform it, in the traveller's words. One source of truth so the hint
 * on screen and what a screen reader announces cannot drift from the native
 * pattern in plugins/withPanicVolumeKeys.js.
 */
export const PANIC_GESTURE_HINT = "Or press volume down five times quickly — silent, no alarm.";

/**
 * Call `onPanic` when the pattern has been tapped out. Returns an unsubscribe
 * function; safe to call on any platform.
 */
export function subscribeToPanicKeys(onPanic: () => void): () => void {
  if (!isPanicGestureSupported) return () => {};

  let subscription: EmitterSubscription | null =
    DeviceEventEmitter.addListener(EVENT, onPanic);

  return () => {
    subscription?.remove();
    subscription = null;
  };
}
