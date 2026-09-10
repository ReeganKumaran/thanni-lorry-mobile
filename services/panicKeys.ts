/**
 * The silent panic gesture: both volume keys held together.
 *
 * The on-screen hold sounds an alarm on purpose, which is the wrong tool when
 * being heard is itself the danger. This path raises the same SOS without a
 * sound, without a countdown, and without the screen showing anything — it can
 * be done one-handed, in a pocket, or while someone else is watching the phone.
 *
 * Android only: iOS gives apps no supported way to intercept the volume keys.
 * The keys also only reach the app while it is foregrounded and focused, so
 * this is not a screen-off panic button. See plugins/withPanicVolumeKeys.js.
 */

import { DeviceEventEmitter, Platform } from "react-native";
import type { EmitterSubscription } from "react-native";

const EVENT = "auraPanicVolumeKeys";

/** True where the gesture can work at all. */
export const isPanicGestureSupported = Platform.OS === "android";

/**
 * Call `onPanic` when both volume keys have been held together long enough.
 * Returns an unsubscribe function; safe to call on any platform.
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
