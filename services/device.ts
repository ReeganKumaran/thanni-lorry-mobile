/**
 * Who this phone is, for the trusted contact and the operations console.
 *
 * Identity only. Nothing here reaches the safety engine: the backend decides
 * deviation, inactivity, risk and escalation identically whether or not a
 * traveller ever types their name (AURA_TRD.md §5.1 — the phone holds no safety
 * logic). A traveller who would rather stay unnamed is monitored exactly the
 * same and still appears on the board.
 *
 * Persisted with expo-file-system, which this app already depends on, rather
 * than pulling in a storage library. React Native 0.76 pins React 18.3.1 here
 * and every added native module is a rebuild — see the repo README.
 */
import * as FileSystem from "expo-file-system";
import Constants from "expo-constants";
import { Platform } from "react-native";

const FILE = `${FileSystem.documentDirectory}aura-device.json`;

type Identity = {
  deviceId: string;
  travellerName: string | null;
};

let cached: Identity | null = null;

/** RFC-4122-shaped, from Math.random. This is a label, never a credential. */
function newDeviceId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function read(): Promise<Identity> {
  if (cached) return cached;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (info.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(FILE));
      if (typeof parsed?.deviceId === "string" && parsed.deviceId) {
        cached = {
          deviceId: parsed.deviceId,
          travellerName:
            typeof parsed.travellerName === "string" ? parsed.travellerName : null,
        };
        return cached;
      }
    }
  } catch {
    // A corrupt or unreadable file must never stop a journey starting. Fall
    // through and mint a new id.
  }
  cached = { deviceId: newDeviceId(), travellerName: null };
  void write(cached);
  return cached;
}

async function write(identity: Identity): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(identity));
  } catch {
    // Not fatal: the id stays good for this session, and the journey still runs.
  }
}

export async function getDeviceId(): Promise<string> {
  return (await read()).deviceId;
}

export async function getTravellerName(): Promise<string | null> {
  return (await read()).travellerName;
}

export async function setTravellerName(name: string | null): Promise<void> {
  const identity = await read();
  const trimmed = name?.trim() ?? "";
  cached = { ...identity, travellerName: trimmed.length > 0 ? trimmed.slice(0, 60) : null };
  await write(cached);
}

/** A human name for the handset, e.g. "Sai's iPhone". */
export function getDeviceLabel(): string {
  const named = Constants.deviceName?.trim();
  if (named) return named.slice(0, 60);
  return Platform.OS === "ios" ? "iPhone" : "Android phone";
}

/** The identity fields POST /journeys accepts. All optional server-side. */
export async function journeyIdentity(): Promise<{
  device_id: string;
  device_label: string;
  traveller_name?: string;
}> {
  const identity = await read();
  return {
    device_id: identity.deviceId,
    device_label: getDeviceLabel(),
    ...(identity.travellerName ? { traveller_name: identity.travellerName } : {}),
  };
}
