# AURA Mobile — v1

React Native + Expo companion app. It creates a monitored journey, streams GPS
into the FastAPI backend, and shows the traveller the safety state the backend
decides on. The app holds **no safety logic of its own** (AURA_TRD.md §5.1) —
every state on screen was read back from `services/api`.

Backend, shared types and the design/TRD documents this app is built against
live in [NINJA981/Thanni-Lorry](https://github.com/NINJA981/Thanni-Lorry).

## What v1 does

| Capability | Endpoint |
| :-- | :-- |
| Start a monitored journey from the current position | `POST /api/v1/journeys` |
| Stream GPS at ~1 Hz, with offline buffering and replay | `POST /api/v1/locations?journey_id=` |
| Track safety state between GPS fixes | `GET /api/v1/safety/status?journey_id=` |
| Read the check-in prompt text | `GET /api/v1/events/history` |
| Answer a safety check / raise an SOS | `POST /api/v1/safety/checkin?journey_id=` |
| Show whether the phone is reaching the backend | `GET /health` |

Spoken guidance runs through `expo-speech` with the audio priority ladder from
AURA_DESIGN.md §32, so the traveller is not narrated at.

## Running it

```bash
# 1. Backend — from a clone of NINJA981/Thanni-Lorry
uvicorn app.main:app --reload --host 0.0.0.0 --port 8200   # in services/api

# 2. App — from this repo
npm install
npm start
```

Then scan the QR code with Expo Go.

### Why this app is its own repo

React Native 0.76 needs React 18.3.1 while the backend monorepo's `apps/console`
(Next 15) needs React 19. Sharing one hoisted `node_modules` strands Expo's build
tooling at the workspace root, away from the `expo` package it has to load, and
bundling fails with `Cannot find module 'expo/config'`. Standing on its own
install sidesteps that entirely.

`@aura/types` is still the contract for enums and domain-event shapes. Because
there is no sibling workspace to resolve, the package is vendored at
`types/aura-types.ts` and the `paths` entry in `tsconfig.json` maps the
`@aura/types` specifier onto it — so app code imports it under the original name
and re-syncing is a single file copy from the backend repo.

### Reaching the backend from a real phone

`localhost` on a phone is the phone. The app resolves the backend in this order:

1. the host typed into **Change** on the home screen (session-scoped)
2. `EXPO_PUBLIC_AURA_API_URL` (see `.env.example`)
3. the Expo dev-server host — in Expo Go this is already the laptop's LAN IP, so
   the app just swaps in port 8200. This is the path that usually works with no
   configuration at all.
4. `http://localhost:8200`, which only helps in the simulator or on web

The home screen shows the resolved origin and whether `/health` answered, so a
wrong host is visible before a journey starts rather than after.

Uvicorn binds to loopback by default. For a real phone, serve on the LAN:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8200
```

## Layout

```text
thanni-lorry-mobile/
├── App.tsx                       # root: home <-> journey, safety-check takeover
├── screens/
│   ├── HomeScreen.tsx            # destination, quick presets, backend host
│   └── JourneyScreen.tsx         # status banner, telemetry, SOS, end journey
├── components/
│   ├── AccessibleButton.tsx      # 64px targets, 96px for safety actions
│   ├── SafetyStatusBanner.tsx    # plain-language state (AURA_DESIGN.md §11)
│   ├── SafetyCheckModal.tsx      # full-screen takeover (AURA_DESIGN.md §12)
│   ├── TelemetryPanel.tsx        # off route / stopped for / arrival
│   └── ConnectionBadge.tsx       # reporting vs. holding updates
├── hooks/
│   └── useJourneyMonitor.ts      # journey lifecycle + GPS stream + state sync
├── services/
│   ├── api.ts                    # typed client
│   ├── location.ts               # expo-location capture, normalize, replay queue
│   ├── speech.ts                 # prioritised TTS
│   └── config.ts                 # backend host resolution
├── constants/                    # design tokens, safety copy
└── types/
    ├── api.ts                    # wire shapes; enums come from @aura/types
    └── aura-types.ts             # vendored @aura/types contract
```

## Verified against the backend

Every request above was exercised against a live `services/api`: journey
creation, on-route and off-route location updates, the `SAFE` → `UNUSUAL` →
`CHECKING` transition that raises the takeover, reading `SAFETY_CHECK_SENT` out
of the event history, and both `SAFE` and `HELP` check-in answers (the latter
returning `ESCALATED`). Both platforms bundle clean via `expo export`.

## Known gaps for v2

- **Cleartext HTTP is only declared for debug builds.** `usesCleartextTraffic`
  comes from Expo's `android/app/src/debug/AndroidManifest.xml`, which is why the
  app talks plain HTTP to the API and the edge node today. That manifest does not
  apply to a release build, so **the first release build will fail to reach either
  service** — a release blocker, not a bug in the current setup. The fix is a
  scoped `networkSecurityConfig` permitting localhost and the private LAN ranges,
  not blanket cleartext.
- **What the hazard camera can and cannot see.** The edge model reliably finds
  broken and cracked pavement. It does **not** reliably identify potholes from a
  pedestrian's viewpoint, and nothing wired in detects kerbs, steps, open
  manholes, raised paving or missing tactile paving — the node lists those on
  `GET /health` and never emits them. Hearing nothing at a pothole may be correct.
  See `services/edge/HAZARD_MODEL.md` in the backend repo.
- **Sign reading is off.** PaddleOCR has no Python 3.14 wheel, so the edge node
  reports `status: degraded` with `unavailable_slots: ["text"]` and emits no text
  events at all. It used to substitute a mock, which put a scripted "STAIRS" sign
  on the live event stream as a real obstacle; silence is the correct behaviour
  and the substitution is now blocked.
- **Background location.** Foreground only. `UIBackgroundModes` is declared but
  `expo-task-manager` is not wired up. Camera capture also stops when the app
  leaves the foreground, deliberately — battery and privacy.
- **The silent panic gesture is foreground-only too.** Android delivers volume
  keys only to the focused app, so it is not a screen-off panic button.

## Closed since v1

These were listed as gaps and are now done — kept so the list above is read as
current rather than aspirational.

- **Map.** Leaflet over OpenStreetMap tiles in a `react-native-webview`. No
  Mapbox token, no native map dependency, no API key of any kind.
- **Camera to the edge node.** Wired end to end: frames go to
  `services/edge/process-frame`, its events reach the API and the console over
  SSE, and hazards are spoken on the phone.
- **Voice control.** `expo-speech-recognition` for input, with the command
  vocabulary biased into the recogniser and alternatives matched against the
  grammar for noisy streets.
- **Journey routing.** `create_journey` honours the origin the phone sends and
  the route comes from OSRM, so deviation is measured against a real path.
