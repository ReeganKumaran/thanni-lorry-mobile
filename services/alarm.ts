/**
 * The SOS alarm tone.
 *
 * From the third second of the hold the escalation stops being private: a
 * two-tone alarm plays, so anyone nearby hears that help is being called for.
 * It plays through the silent switch on purpose — someone reaching for an SOS
 * has not stopped to check whether their phone is muted.
 */

import { requireOptionalNativeModule } from "expo";

// Type-only: erased at build time, so it cannot drag the native module in.
import type { Audio as AudioNamespace } from "expo-av";

type ExpoAv = { Audio: typeof AudioNamespace };
type LoadedSound = AudioNamespace.Sound;

/** undefined = not tried yet, null = tried and unavailable. */
let expoAv: ExpoAv | null | undefined;
let sound: LoadedSound | null = null;
let loading = false;

/**
 * expo-av is probed for, then required — never imported outright.
 *
 * `import { Audio } from "expo-av"` throws at module-evaluation time on a
 * binary without the native module ("Cannot find native module 'ExponentAV'"),
 * taking the whole chain down with it: this file, the hold button, the journey
 * screen, the app. Wrapping the require in try/catch is not enough either —
 * Expo reports that failure globally, so it still surfaces as an uncaught
 * error even when caught here.
 *
 * `requireOptionalNativeModule` returns null instead of throwing, which is
 * exactly how expo-haptics stays safe. Asking first means a build without
 * audio is a missing sound rather than a dead app, and the haptic escalation
 * still works before the next native rebuild.
 */
function loadExpoAv(): ExpoAv | null {
  if (expoAv !== undefined) return expoAv;

  if (requireOptionalNativeModule("ExponentAV") == null) {
    expoAv = null;
    return expoAv;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expoAv = require("expo-av") as ExpoAv;
  } catch {
    expoAv = null;
  }
  return expoAv;
}

/** True when this build can actually make a sound. */
export function isAlarmAvailable(): boolean {
  return loadExpoAv() !== null;
}

async function ensureLoaded(): Promise<LoadedSound | null> {
  if (sound) return sound;
  if (loading) return null;

  const av = loadExpoAv();
  if (!av) return null;

  loading = true;
  try {
    await av.Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });
    const { sound: created } = await av.Audio.Sound.createAsync(
      require("../assets/alarm.wav"),
      { isLooping: true, volume: 1.0 },
    );
    sound = created;
    return sound;
  } catch {
    // No audio route on this device; the haptics still carry the escalation.
    return null;
  } finally {
    loading = false;
  }
}

/** Load the tone ahead of time so the third second is not spent decoding. */
export function prepareAlarm(): void {
  void ensureLoaded();
}

export async function startAlarm(): Promise<void> {
  const player = await ensureLoaded();
  if (!player) return;
  try {
    await player.setPositionAsync(0);
    await player.playAsync();
  } catch {
    // Nothing to do — never let the alarm failing block the SOS itself.
  }
}

export async function stopAlarm(): Promise<void> {
  if (!sound) return;
  try {
    await sound.stopAsync();
  } catch {
    // Already stopped or unloaded.
  }
}

/** Release the audio resource when the screen holding it goes away. */
export async function releaseAlarm(): Promise<void> {
  const player = sound;
  sound = null;
  if (!player) return;
  try {
    await player.unloadAsync();
  } catch {
    // Already gone.
  }
}
