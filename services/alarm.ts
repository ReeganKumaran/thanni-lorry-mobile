/**
 * The SOS alarm tone.
 *
 * From the third second of the hold the escalation stops being private: a
 * two-tone alarm plays, so anyone nearby hears that help is being called for.
 * It plays through the silent switch on purpose — someone reaching for an SOS
 * has not stopped to check whether their phone is muted.
 */

import { Audio } from "expo-av";

let sound: Audio.Sound | null = null;
let loading = false;

async function ensureLoaded(): Promise<Audio.Sound | null> {
  if (sound) return sound;
  if (loading) return null;
  loading = true;

  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
    });
    const { sound: created } = await Audio.Sound.createAsync(
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
