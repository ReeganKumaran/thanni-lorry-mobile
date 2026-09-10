/**
 * Resolving the backend base URL.
 *
 * On a phone, `localhost` is the phone. The backend runs on the developer's
 * laptop, so the app needs that laptop's LAN address. Resolution order:
 *
 *   1. a host the user typed on the home screen (survives for the session)
 *   2. EXPO_PUBLIC_AURA_API_URL / extra.auraApiUrl from the Expo config
 *   3. the Expo dev-server host — in Expo Go this is already the laptop's LAN
 *      IP, so we reuse it and swap in the API port
 *   4. http://localhost:8000, which only works in the web/simulator case
 */

import Constants from "expo-constants";

export const API_PORT = 8000;
export const API_PREFIX = "/api/v1";

let overrideBaseUrl: string | null = null;

function normalize(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/** Host:port the Expo dev server is being served from, e.g. "192.168.1.10:8081". */
function expoHostUri(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null;
  const legacy = (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } })
    .expoGoConfig;
  return config?.hostUri ?? legacy?.debuggerHost ?? null;
}

function fromExpoHost(): string | null {
  const hostUri = expoHostUri();
  if (!hostUri) return null;
  const host = hostUri.split(":")[0];
  if (!host) return null;
  return `http://${host}:${API_PORT}`;
}

function fromEnv(): string | null {
  const fromProcess = process.env.EXPO_PUBLIC_AURA_API_URL;
  const fromExtra = (Constants.expoConfig?.extra as { auraApiUrl?: string } | undefined)
    ?.auraApiUrl;
  const raw = fromProcess || fromExtra;
  return raw ? normalize(raw) : null;
}

/** Root of the backend, without the /api/v1 prefix. */
export function getApiOrigin(): string {
  return overrideBaseUrl ?? fromEnv() ?? fromExpoHost() ?? `http://localhost:${API_PORT}`;
}

/** Base URL including the versioned prefix. */
export function getApiBaseUrl(): string {
  return `${getApiOrigin()}${API_PREFIX}`;
}

/**
 * Point the app at a different backend at runtime. Accepts a bare host
 * ("192.168.1.10"), host:port, or a full URL. Pass null to fall back to
 * automatic resolution.
 */
export function setApiOrigin(value: string | null): string {
  if (value === null || value.trim() === "") {
    overrideBaseUrl = null;
    return getApiOrigin();
  }

  let candidate = normalize(value);
  // A bare host with no port is almost always meant to hit the API port.
  if (!/:\d+$/.test(candidate.replace(/^https?:\/\//i, ""))) {
    candidate = `${candidate}:${API_PORT}`;
  }
  overrideBaseUrl = candidate;
  return overrideBaseUrl;
}

/** True when the user has pinned a host by hand. */
export function hasApiOriginOverride(): boolean {
  return overrideBaseUrl !== null;
}
