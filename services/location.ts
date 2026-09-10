/**
 * GPS capture and streaming.
 *
 *   Expo Location -> normalize -> POST /locations -> Journey Engine
 *
 * Readings that fail to send are buffered and replayed in order, so a lift ride
 * or a dead-spot does not punch a hole in the journey trail. The backend treats
 * client timestamps as untrusted (AURA_TRD.md section 7), so a replayed reading
 * still carries the moment it was actually taken.
 */

import * as Location from "expo-location";

import type { LocationUpdateBody, LocationUpdateResult } from "../types/api";
import { ApiError, postLocation } from "./api";

/** Roughly 1 Hz, per AURA_TRD.md section 7. */
const UPDATE_INTERVAL_MS = 1000;

/** Cap the replay buffer so a long outage cannot grow memory without bound. */
const MAX_BUFFERED_READINGS = 60;

export type LocationStreamHandlers = {
  onTelemetry?: (reading: LocationUpdateBody, result: LocationUpdateResult) => void;
  onReadingCaptured?: (reading: LocationUpdateBody) => void;
  onError?: (error: Error) => void;
  onConnectionChange?: (online: boolean) => void;
  onBufferChange?: (pendingCount: number) => void;
};

export type PermissionOutcome = {
  granted: boolean;
  /** True when the user chose "don't ask again" and must visit Settings. */
  blocked: boolean;
};

export async function requestLocationPermission(): Promise<PermissionOutcome> {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  return {
    granted: status === Location.PermissionStatus.GRANTED,
    blocked: status !== Location.PermissionStatus.GRANTED && !canAskAgain,
  };
}

export async function getCurrentPosition(): Promise<LocationUpdateBody> {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return normalize(position);
}

/**
 * Expo reports -1 for speed and heading when the fix cannot determine them, and
 * null for accuracy. The backend's inactivity engine reads speed directly, so an
 * unknown value has to become 0 rather than a negative.
 */
function normalize(position: Location.LocationObject): LocationUpdateBody {
  const { coords, timestamp } = position;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy != null && coords.accuracy > 0 ? coords.accuracy : 25,
    speed_mps: coords.speed != null && coords.speed > 0 ? coords.speed : 0,
    heading: coords.heading != null && coords.heading >= 0 ? coords.heading : 0,
    client_timestamp: new Date(timestamp).toISOString(),
  };
}

export class LocationStreamer {
  private subscription: Location.LocationSubscription | null = null;
  private journeyId: string | null = null;
  private handlers: LocationStreamHandlers = {};
  private buffer: LocationUpdateBody[] = [];
  private online = true;
  private sending = false;

  get isRunning(): boolean {
    return this.subscription !== null;
  }

  async start(journeyId: string, handlers: LocationStreamHandlers = {}): Promise<void> {
    await this.stop();

    this.journeyId = journeyId;
    this.handlers = handlers;
    this.buffer = [];
    this.online = true;

    this.subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: UPDATE_INTERVAL_MS,
        distanceInterval: 0,
      },
      (position) => {
        const reading = normalize(position);
        this.handlers.onReadingCaptured?.(reading);
        this.enqueue(reading);
        void this.flush();
      },
    );
  }

  async stop(): Promise<void> {
    this.subscription?.remove();
    this.subscription = null;
    this.journeyId = null;
    this.buffer = [];
  }

  private enqueue(reading: LocationUpdateBody): void {
    this.buffer.push(reading);
    if (this.buffer.length > MAX_BUFFERED_READINGS) {
      // Drop the oldest: a fresh position matters more than a stale one.
      this.buffer.splice(0, this.buffer.length - MAX_BUFFERED_READINGS);
    }
    this.handlers.onBufferChange?.(this.buffer.length);
  }

  /** Send buffered readings oldest-first; one flush at a time. */
  private async flush(): Promise<void> {
    if (this.sending || !this.journeyId) return;
    this.sending = true;

    try {
      while (this.buffer.length > 0) {
        const journeyId = this.journeyId;
        if (!journeyId) break;

        const reading = this.buffer[0];
        let result: LocationUpdateResult;

        try {
          result = await postLocation(journeyId, reading);
        } catch (error) {
          this.setOnline(false);
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            // The backend rejected this reading outright; replaying it will not
            // help, so drop it and surface the reason.
            this.buffer.shift();
            this.handlers.onBufferChange?.(this.buffer.length);
          }
          this.handlers.onError?.(error as Error);
          return;
        }

        this.buffer.shift();
        this.handlers.onBufferChange?.(this.buffer.length);
        this.setOnline(true);

        // Only the newest reading reflects where the traveller is now.
        if (this.buffer.length === 0) {
          this.handlers.onTelemetry?.(reading, result);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private setOnline(next: boolean): void {
    if (this.online === next) return;
    this.online = next;
    this.handlers.onConnectionChange?.(next);
  }
}
