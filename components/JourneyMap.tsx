import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import { colors, fontSize, fontWeight, radius, space } from "../constants/theme";
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
  .leaflet-control-attribution { font-size: 9px; }
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
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var map = L.map('map', { zoomControl: false, attributionControl: true })
             .setView([13.0827, 80.2707], 16);
  var FOLLOW_ZOOM = 16;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  var routeLayer = L.layerGroup().addTo(map);
  var trailLayer = L.layerGroup().addTo(map);
  var placeLayer = L.layerGroup().addTo(map);
  var here = null;
  var following = true;

  // Panning by hand means the traveller wants to look around; stop yanking
  // the view back until they ask for it.
  map.on('dragstart', function () {
    following = false;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ following: false }));
    }
  });

  window.auraRecentre = function () {
    following = true;
    if (here) map.setView(here.getLatLng(), Math.max(map.getZoom(), FOLLOW_ZOOM));
  };

  window.auraUpdate = function (payload) {
    var data = typeof payload === 'string' ? JSON.parse(payload) : payload;

    // Planned route: dashed and quiet, so the walked trail reads on top of it.
    routeLayer.clearLayers();
    if (data.route && data.route.length > 1) {
      L.polyline(data.route, {
        color: '${colors.statusInfo}', weight: 4, opacity: 0.45,
        dashArray: '10 8', lineCap: 'round'
      }).addTo(routeLayer);
      L.circleMarker(data.route[data.route.length - 1], {
        radius: 6, color: '#fff', weight: 2,
        fillColor: '${colors.statusInfo}', fillOpacity: 1
      }).addTo(routeLayer).bindTooltip('Destination');
    }

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
        map.setView(latlng, FOLLOW_ZOOM);
      } else {
        here.setLatLng(latlng);
        var el = here.getElement();
        if (el) el.innerHTML = body;
      }
      if (following) map.panTo(latlng, { animate: true, duration: 0.5 });
    }
  };
})();
</script>
</body>
</html>`;

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

  const payload = useMemo(
    () =>
      JSON.stringify({
        // Leaflet wants [lat, lng]; the route arrives as [lng, lat].
        route: plannedRoute.map(([lng, lat]) => [lat, lng]),
        trail: trail.map((p) => ({
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
    [plannedRoute, trail, places, latitude, longitude, heading, safetyState],
  );

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
        // Leaflet's attribution is a real link. Letting the WebView follow it
        // navigates the map away — mid-journey that replaces the live map with
        // a web page. Only the inline document may load.
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank" || request.url.startsWith("data:")
        }
        onLoadEnd={() => {
          readyRef.current = true;
          webviewRef.current?.injectJavaScript(
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
    minHeight: 44,
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
