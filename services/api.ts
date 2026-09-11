/**
 * Typed client for the AURA backend.
 *
 * Route shapes follow services/api as implemented: location updates and
 * check-in responses take the journey as a `journey_id` query parameter rather
 * than the path form sketched in AURA_TRD.md section 16.
 */

import type {
  BaseDomainEvent,
  CheckinResponse,
  KnownPlace,
  CheckinResult,
  CreateJourneyBody,
  GeocodeResult,
  Journey,
  LocationUpdateBody,
  LocationUpdateResult,
  PendingSafetyCheck,
  SafetyStatus,
} from "../types/api";
import { getApiBaseUrl, getApiOrigin } from "./config";

/** Requests are short-lived: a stalled phone radio should not wedge the queue. */
const REQUEST_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { base = getApiBaseUrl(), timeoutMs = REQUEST_TIMEOUT_MS } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!res.ok) {
      throw new ApiError(await describeFailure(res), res.status);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("The backend did not respond in time.", 0);
    }
    throw new ApiError(
      `Can't reach AURA at ${getApiOrigin()}. Check the backend host.`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function describeFailure(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // Fall through to the generic message.
  }
  return `Request failed with status ${res.status}.`;
}

/** Liveness probe, used to show a connection state before a journey starts. */
export async function checkHealth(): Promise<boolean> {
  try {
    await request<unknown>("/health", {}, { base: getApiOrigin(), timeoutMs: 4000 });
    return true;
  } catch {
    return false;
  }
}

export function createJourney(body: CreateJourneyBody): Promise<Journey> {
  return request<Journey>("/journeys", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function completeJourney(journeyId: string): Promise<Journey> {
  return request<Journey>(`/journeys/${journeyId}/complete`, { method: "POST" });
}

export function getActiveJourney(): Promise<Journey | null> {
  return request<Journey | null>("/journeys/active");
}

export function getJourney(journeyId: string): Promise<Journey> {
  return request<Journey>(`/journeys/${journeyId}`);
}

export function postLocation(
  journeyId: string,
  body: LocationUpdateBody,
): Promise<LocationUpdateResult> {
  return request<LocationUpdateResult>(
    `/locations?journey_id=${encodeURIComponent(journeyId)}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function getSafetyStatus(journeyId: string): Promise<SafetyStatus> {
  return request<SafetyStatus>(
    `/safety/status?journey_id=${encodeURIComponent(journeyId)}`,
  );
}

export function respondToCheckin(
  journeyId: string,
  response: CheckinResponse,
  transcript?: string,
): Promise<CheckinResult> {
  return request<CheckinResult>(
    `/safety/checkin?journey_id=${encodeURIComponent(journeyId)}`,
    {
      method: "POST",
      body: JSON.stringify({ response, transcript: transcript ?? null }),
    },
  );
}

export function listPlaces(): Promise<KnownPlace[]> {
  return request<KnownPlace[]>("/places");
}

/**
 * Save a spot where being stopped is normal. Re-using a label replaces it, so
 * "Home" can never end up meaning two different buildings.
 */
export function createPlace(
  label: string,
  latitude: number,
  longitude: number,
  radiusMeters: number,
): Promise<KnownPlace> {
  return request<KnownPlace>("/places", {
    method: "POST",
    body: JSON.stringify({
      label,
      latitude,
      longitude,
      radius_meters: radiusMeters,
    }),
  });
}

/**
 * Search for a place by name or address.
 *
 * The geocoding call itself happens on the backend, which is where the maps
 * credential lives. The app used to call a geocoding service directly, which
 * meant shipping a key in the bundle.
 *
 * Call on submit, not per keystroke: the backend honours the upstream services'
 * rate limits on this path, and a search per keystroke would exhaust them.
 */
export function searchPlaces(
  query: string,
  near?: { latitude: number; longitude: number },
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({ q: query });
  if (near) {
    params.set("latitude", String(near.latitude));
    params.set("longitude", String(near.longitude));
  }
  return request<GeocodeResult[]>(`/places/search?${params.toString()}`);
}

/**
 * Describe a dropped pin as an address, so it can be read aloud.
 *
 * Returns null when nothing can name the point — a pin without an address is
 * still a usable pin, and the picker must not fail over a missing label.
 */
export async function describePoint(
  latitude: number,
  longitude: number,
): Promise<GeocodeResult | null> {
  try {
    return await request<GeocodeResult | null>(
      `/places/describe?latitude=${latitude}&longitude=${longitude}`,
    );
  } catch {
    return null;
  }
}

export function deletePlace(placeId: string): Promise<unknown> {
  return request<unknown>(`/places/${encodeURIComponent(placeId)}`, {
    method: "DELETE",
  });
}

export function getEventHistory(): Promise<BaseDomainEvent[]> {
  return request<BaseDomainEvent[]>("/events/history");
}

/**
 * The safety engine puts the prompt text on a SAFETY_CHECK_SENT event rather
 * than on /safety/status, so the modal reads it out of the event history.
 */
export async function fetchPendingSafetyCheck(
  journeyId: string,
): Promise<PendingSafetyCheck | null> {
  const events = await getEventHistory();

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.journey_id !== journeyId) continue;

    // A response or an escalation closes out the check that preceded it.
    if (event.type === "USER_RESPONDED" || event.type === "USER_NO_RESPONSE") {
      return null;
    }

    if (event.type === "SAFETY_CHECK_SENT") {
      const payload = event.payload as {
        check_id?: string;
        prompt_message?: string;
        trigger_reason?: string;
        timeout_seconds?: number;
      };
      return {
        checkId: payload.check_id ?? event.id,
        message: payload.prompt_message ?? "Are you safe?",
        reason: payload.trigger_reason ?? "",
        timeoutSeconds: payload.timeout_seconds ?? 45,
        sentAt: event.timestamp,
      };
    }
  }

  return null;
}

/** Who AURA calls when it escalates. Reads never carry the full number. */
export type TrustedContact = {
  user_id: string;
  name: string;
  phone_redacted: string;
  relationship: string;
  updated_at: string;
  set_by_traveller: boolean;
};

/** Whether an escalation would reach anybody, without revealing who. */
export type TrustedContactStatus = {
  configured: boolean;
  source: "traveller" | "environment" | "none";
  name?: string | null;
  phone_redacted?: string | null;
};

export function getTrustedContact(): Promise<TrustedContact | null> {
  return request<TrustedContact | null>("/contacts/trusted");
}

/**
 * Set the person AURA calls. Saving again replaces the previous one — there is
 * deliberately only ever one, because "which of your three contacts did we
 * call?" is not a question anyone wants to answer afterwards.
 *
 * The number is sent as typed; the server validates E.164 and stores it. It is
 * never read back in full.
 */
export function saveTrustedContact(
  name: string,
  phone: string,
): Promise<TrustedContact> {
  return request<TrustedContact>("/contacts/trusted", {
    method: "PUT",
    body: JSON.stringify({ name, phone }),
  });
}

export function deleteTrustedContact(): Promise<unknown> {
  return request<unknown>("/contacts/trusted", { method: "DELETE" });
}

/**
 * Asked before a journey starts. "AURA has nobody to call" is something a
 * traveller has to learn *before* they need it, not from a failed escalation.
 */
export function getTrustedContactStatus(): Promise<TrustedContactStatus> {
  return request<TrustedContactStatus>("/contacts/trusted/status");
}
