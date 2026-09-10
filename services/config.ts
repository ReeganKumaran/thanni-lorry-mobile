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

/**
 * The edge CV node (services/edge) runs beside the API on the same machine.
 * Over USB both are reached through `adb reverse`, so the phone talks to
 * localhost for each and never needs a LAN address.
 */
export const EDGE_PORT = 8001;

let overrideBaseUrl: string | null = null;
let overrideEdgeUrl: string | null = null;

/**
 * Anything reaching us from the Expo config or process.env is unvalidated at
 * runtime, whatever its declared type says. `extra: { auraApiUrl: null }` in
 * app.json, for instance, resolves to `{}` — truthy, and with no `.trim`.
 */
function asHostString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalize(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/** Host:port the Expo dev server is being served from, e.g. "192.168.1.10:8081". */
function expoHostUri(): string | null {
  const config = Constants.expoConfig as Record<string, unknown> | null;
  const legacy = (Constants as unknown as { expoGoConfig?: Record<string, unknown> })
    .expoGoConfig;
  return asHostString(config?.hostUri) ?? asHostString(legacy?.debuggerHost);
}

function fromExpoHost(port: number): string | null {
  const hostUri = expoHostUri();
  if (!hostUri) return null;
  const host = hostUri.split(":")[0];
  if (!host) return null;
  return `http://${host}:${port}`;
}

function fromEnv(): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const raw =
    asHostString(process.env.EXPO_PUBLIC_AURA_API_URL) ?? asHostString(extra?.auraApiUrl);
  return raw ? normalize(raw) : null;
}

function edgeFromEnv(): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const raw =
    asHostString(process.env.EXPO_PUBLIC_AURA_EDGE_URL) ?? asHostString(extra?.auraEdgeUrl);
  return raw ? normalize(raw) : null;
}

/** Swap the port on an already-resolved origin, keeping scheme and host. */
function withPort(origin: string, port: number): string {
  return origin.replace(/^(https?:\/\/[^/:]+)(?::\d+)?$/i, `$1:${port}`);
}

/** Root of the backend, without the /api/v1 prefix. */
export function getApiOrigin(): string {
  return overrideBaseUrl ?? fromEnv() ?? fromExpoHost(API_PORT) ?? `http://localhost:${API_PORT}`;
}

/**
 * Root of the edge CV node.
 *
 * A host typed into "Change" on the home screen is about *this laptop*, not
 * about one service on it, so the edge follows it on its own port unless the
 * edge has been pinned separately. Otherwise the resolution order matches the
 * API's.
 */
export function getEdgeOrigin(): string {
  if (overrideEdgeUrl) return overrideEdgeUrl;
  const explicit = edgeFromEnv();
  if (explicit) return explicit;
  if (overrideBaseUrl) return withPort(overrideBaseUrl, EDGE_PORT);
  return fromExpoHost(EDGE_PORT) ?? `http://localhost:${EDGE_PORT}`;
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
  const host = asHostString(value);
  if (host === null) {
    overrideBaseUrl = null;
    return getApiOrigin();
  }

  let candidate = normalize(host);
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

/** Point the app at a different edge node. Pass null to fall back to automatic. */
export function setEdgeOrigin(value: string | null): string {
  const host = asHostString(value);
  if (host === null) {
    overrideEdgeUrl = null;
    return getEdgeOrigin();
  }

  let candidate = normalize(host);
  if (!/:\d+$/.test(candidate.replace(/^https?:\/\//i, ""))) {
    candidate = `${candidate}:${EDGE_PORT}`;
  }
  overrideEdgeUrl = candidate;
  return overrideEdgeUrl;
}
