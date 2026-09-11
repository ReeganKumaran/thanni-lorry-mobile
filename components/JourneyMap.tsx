import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { colors, fontSize, fontWeight, radius, space, touchTarget } from "../constants/theme";
import type { KnownPlace, SafetyState } from "../types/api";
import type { TrailPoint } from "../hooks/useJourneyMonitor";

type Props = {
  /** Planned route as [longitude, latitude] pairs. */
  plannedRoute: [number, number][];
  trail: TrailPoint[];
  latitude: number | null;
  longitude: number | null;
  heading: number;
  safetyState: SafetyState;
  places: KnownPlace[];
};

/** Trail colour follows the safety state at the moment it was walked. */
const STATE_COLOR: Record<SafetyState, string> = {
  SAFE: colors.statusSafe,
  RESOLVED: colors.statusSafe,
  UNUSUAL: colors.statusAttention,
  UNCERTAIN: colors.statusAttention,
  CHECKING: colors.statusInfo,
  HIGH_RISK: colors.statusRisk,
  ESCALATED: colors.statusRisk,
};

/**
 * The live journey map.
 *
 * AURA_DESIGN.md section 25: show the route walked, the current position and
 * real deviations — nothing else. No detection pins, no floating bubbles, no
 * statistics pasted over the map.
 *
 * Updates are injected rather than re-rendered: rebuilding the HTML on every
 * GPS fix would throw away whatever the traveller had panned or zoomed to.
 */
const BASE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; height: 100%; width: 100%; background: ${colors.surfaceMuted}; }
  /* Attribution is required by the OSM tile usage policy, so it is still
     shown — but drawn here rather than by Leaflet's control. Leaflet's own
     control injects two focusable nodes into the accessibility tree, which a
     screen-reader user has to swipe past to reach anything real. */
  .aura-attribution {
    position: absolute; right: 0; bottom: 0; z-index: 500;
    font: 9px -apple-system, system-ui, sans-serif;
    color: #666661; background: rgba(255,255,255,0.75);
    padding: 1px 4px; pointer-events: none;
  }
  /* Leaflet draws its zoom buttons at about 26px. CLAUDE.md rule 6 sets the
     floor for this product at 44x44, well above the 24x24 WCAG 2.2 asks for, and
     these are the only way to zoom without a pinch — which is the gesture
     someone with a tremor or one usable hand cannot make (WCAG 2.5.7). */
  .leaflet-control-zoom a {
    width: 44px; height: 44px; line-height: 44px;
    font-size: 20px; color: #171717;
  }
  .aura-wrap { position: relative; width: 40px; height: 40px; }
  .aura-cone {
    position: absolute; left: 50%; top: 50%;
    width: 0; height: 0; margin-left: -13px; margin-top: -26px;
    border-left: 13px solid transparent; border-right: 13px solid transparent;
    border-bottom: 26px solid rgba(40,86,163,0.28);
    transform-origin: 50% 100%;
  }
  .aura-here {
    position: absolute; left: 50%; top: 50%;
    width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 8px;
    border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  }
</style>
</head>
<body>
<div id="map"></div>
<div class="aura-attribution" aria-hidden="true">&copy; OpenStreetMap</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  // Zoom buttons are on, and that is an accessibility requirement rather than a
  // preference: with them off, pinch — a two-point drag — was the only way to
  // zoom, which WCAG 2.2 section 2.5.7 (Dragging Movements) does not allow for a
  // non-essential interaction. Top-left, clear of the Recentre control.
  var map = L.map('map', { zoomControl: true, attributionControl: false })
             .setView([13.0827, 80.2707], 16);
  map.zoomControl.setPosition('topleft');
  var FOLLOW_ZOOM = 16;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: ''
  }).addTo(map);

  var routeLayer = L.layerGroup().addTo(map);
  var trailLayer = L.layerGroup().addTo(map);
  var placeLayer = L.layerGroup().addTo(map);
  var here = null;
  var following = true;

  // True while WE are moving the map, so our own setView/panTo does not look
  // like the traveller reaching for it. Leaflet fires the same dragstart and
  // zoomstart events either way, so without this flag every programmatic
  // recentre immediately switches following back off.
  var selfMoving = false;

  function withSelfMove(fn) {
    selfMoving = true;
    try { fn(); } finally {
      // Cleared after the event loop turn, once Leaflet has emitted its events.
      //
      // This relies on Leaflet 1.9.4 dispatching movestart/zoomstart
      // SYNCHRONOUSLY from setView/panTo, which it does but does not promise.
      // It holds for the calls made here (panTo to follow, setView at an
      // unchanged zoom — neither fires zoomstart, and dragstart is user-only).
      // If a future change animates a ZOOM from here, check map._animatingZoom
      // rather than trusting this timer.
      setTimeout(function () { selfMoving = false; }, 0);
    }
  }

  function releaseFollow() {
    if (selfMoving || !following) return;
    following = false;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ following: false }));
    }
  }

  // Panning or zooming by hand means the traveller wants to look around; stop
  // yanking the view back until they ask for it. Pinch-zoom counts: it used to
  // be ignored, so a traveller who zoomed out to see the whole route had the
  // map snap back to their own feet on the next GPS fix.
  map.on('dragstart', releaseFollow);
  map.on('zoomstart', releaseFollow);

  window.auraRecentre = function () {
    following = true;
    if (here) {
      withSelfMove(function () {
        map.setView(here.getLatLng(), Math.max(map.getZoom(), FOLLOW_ZOOM));
      });
    }
  };

  // The planned route does not change while it is being walked, so it is drawn
  // once on its own call rather than rebuilt on every GPS fix. Rebuilding it at
  // 1 Hz meant re-creating a polyline of up to a thousand vertices every second.
  window.auraSetRoute = function (payload) {
    var route = typeof payload === 'string' ? JSON.parse(payload) : payload;
    routeLayer.clearLayers();
    if (!route || route.length < 2) return;

    // Dashed and quiet, so the walked trail reads on top of it.
    L.polyline(route, {
      color: '${colors.statusInfo}', weight: 4, opacity: 0.45,
      dashArray: '10 8', lineCap: 'round'
    }).addTo(routeLayer);
    L.circleMarker(route[route.length - 1], {
      radius: 6, color: '#fff', weight: 2,
      fillColor: '${colors.statusInfo}', fillOpacity: 1
    }).addTo(routeLayer).bindTooltip('Destination');
  };

  window.auraUpdate = function (payload) {
    var data = typeof payload === 'string' ? JSON.parse(payload) : payload;

    // Actual route, drawn in segments so a deviation shows where it happened.
    trailLayer.clearLayers();
    var pts = data.trail || [];
    for (var i = 1; i < pts.length; i++) {
      L.polyline(
        [[pts[i-1].lat, pts[i-1].lng], [pts[i].lat, pts[i].lng]],
        { color: pts[i].color, weight: 5, opacity: 0.85, lineCap: 'round' }
      ).addTo(trailLayer);
    }

    placeLayer.clearLayers();
    (data.places || []).forEach(function (p) {
      L.circle([p.lat, p.lng], {
        radius: p.radius, color: '${colors.statusSafe}',
        weight: 1, fillOpacity: 0.07
      }).addTo(placeLayer).bindTooltip(p.label, { permanent: false });
    });

    if (data.here) {
      var latlng = [data.here.lat, data.here.lng];
      var body =
        '<div class="aura-wrap">' +
          '<div class="aura-cone" style="transform:rotate(' + (data.here.heading || 0) + 'deg)"></div>' +
          '<div class="aura-here" style="background:' + data.here.color + '"></div>' +
        '</div>';

      if (!here) {
        here = L.marker(latlng, {
          icon: L.divIcon({ className: '', html: body, iconSize: [40, 40], iconAnchor: [20, 20] })
        }).addTo(map);
        withSelfMove(function () { map.setView(latlng, FOLLOW_ZOOM); });
      } else {
        here.setLatLng(latlng);
        var el = here.getElement();
        if (el) el.innerHTML = body;
      }
      if (following) {
        withSelfMove(function () {
          map.panTo(latlng, { animate: true, duration: 0.5 });
        });
      }
    }
  };
})();
</script>
</body>
</html>`;

/**
 * Keep at most `limit` points, always including the first and last.
 *
 * A real walking route carries well over a thousand vertices, and the trail
 * grows all journey. Both were being serialised in full and pushed across the
 * React Native bridge on every GPS fix. At this scale the extra vertices are
 * sub-pixel: what they cost is a stutter on the one screen that must stay
 * responsive.
 *
 * The endpoints are preserved exactly — thinning a route so that it no longer
 * starts where the traveller is or ends where they are going would change what
 * the map claims.
 */
function thin<T>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;

  const step = (points.length - 1) / (limit - 1);
  const kept: T[] = [];
  for (let i = 0; i < limit - 1; i += 1) {
    kept.push(points[Math.round(i * step)]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/** Enough to draw a walking route smoothly at phone scale. */
const MAX_ROUTE_POINTS = 250;
const MAX_TRAIL_POINTS = 150;

export function JourneyMap({
  plannedRoute,
  trail,
  latitude,
  longitude,
  heading,
  safetyState,
  places,
}: Props) {
  const webviewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const [following, setFollowing] = useState(true);

  // Leaflet wants [lat, lng]; the route arrives as [lng, lat].
  //
  // Depending on the array identity is enough: `useJourneyMonitor` sets
  // `plannedRoute` once when a journey starts and clears it when one ends, never
  // per GPS fix, so this recomputes once per journey. An earlier version hashed
  // the coordinates to guard against a per-fix rebuild that does not happen —
  // which re-walked the whole unthinned route on every render to avoid work that
  // was already being avoided.
  const routePayload = useMemo(
    () => JSON.stringify(thin(plannedRoute, MAX_ROUTE_POINTS).map(([lng, lat]) => [lat, lng])),
    [plannedRoute],
  );

  const payload = useMemo(
    () =>
      JSON.stringify({
        trail: thin(trail, MAX_TRAIL_POINTS).map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
          color: STATE_COLOR[p.safetyState] ?? colors.statusSafe,
        })),
        places: places.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
          radius: p.radius_meters,
          label: p.label,
        })),
        here:
          latitude != null && longitude != null
            ? {
                lat: latitude,
                lng: longitude,
                heading,
                color: STATE_COLOR[safetyState] ?? colors.statusSafe,
              }
            : null,
      }),
    [trail, places, latitude, longitude, heading, safetyState],
  );

  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(
      `window.auraSetRoute && window.auraSetRoute(${JSON.stringify(routePayload)}); true;`,
    );
  }, [routePayload]);

  useEffect(() => {
    if (!readyRef.current) return;
    webviewRef.current?.injectJavaScript(
      `window.auraUpdate && window.auraUpdate(${JSON.stringify(payload)}); true;`,
    );
  }, [payload]);

  const recentre = () => {
    setFollowing(true);
    webviewRef.current?.injectJavaScript("window.auraRecentre && window.auraRecentre(); true;");
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        originWhitelist={["*"]}
        source={{ html: BASE_HTML }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        // The map is hidden from assistive technology, deliberately.
        //
        // Removing Leaflet's attribution control fixed one intrusive node, but
        // the WebView exposes its whole DOM by default — a screen-reader user
        // could still swipe into unlabelled tile images and marker tooltips.
        // Every fact this map conveys already exists as text on this screen
        // (NavigationBanner, JourneyStats, the safety banner), so the map is a
        // visual aid rather than the only route to the information. iOS reads
        // the first prop, Android the second.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        // Leaflet's attribution is a real link. Letting the WebView follow it
        // navigates the map away — mid-journey that replaces the live map with
        // a web page. Only the inline document may load.
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank" || request.url.startsWith("data:")
        }
        onLoadEnd={() => {
          readyRef.current = true;
          webviewRef.current?.injectJavaScript(
            `window.auraSetRoute && window.auraSetRoute(${JSON.stringify(routePayload)});` +
              `window.auraUpdate && window.auraUpdate(${JSON.stringify(payload)}); true;`,
          );
        }}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.following === false) setFollowing(false);
          } catch {
            // Nothing actionable in a malformed message.
          }
        }}
      />

      {!following ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Recentre the map on your position"
          onPress={recentre}
          style={styles.recentre}
        >
          <Text style={styles.recentreLabel}>Recentre</Text>
        </Pressable>
      ) : null}

      {latitude == null ? (
        <View style={styles.waiting} pointerEvents="none">
          <Text style={styles.waitingLabel}>Waiting for GPS…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
  },
  recentre: {
    position: "absolute",
    right: space.compact,
    bottom: space.compact,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    minHeight: touchTarget.min,
    minWidth: touchTarget.min,
    justifyContent: "center",
    paddingHorizontal: space.default,
  },
  recentreLabel: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  waiting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  waitingLabel: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    overflow: "hidden",
    paddingHorizontal: space.default,
    paddingVertical: space.tight,
  },
});
