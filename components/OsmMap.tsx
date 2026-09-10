import { useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import { colors } from "../constants/theme";

type Props = {
  latitude: number;
  longitude: number;
  /** Fired when the traveller taps or drags the pin. */
  onPick: (latitude: number, longitude: number) => void;
  /** Circle drawn around the pin, matching the saved-place radius. */
  radiusMeters?: number;
};

/**
 * An OpenStreetMap picker: Leaflet in a WebView.
 *
 * Leaflet over raw OSM tiles needs no API key and no vendor account, unlike a
 * native maps component on Android. Attribution is required by the OSM tile
 * usage policy and is rendered in the corner.
 */
function buildHtml(lat: number, lng: number, radius: number): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; height: 100%; width: 100%; background: ${colors.surfaceMuted}; }
  .leaflet-control-attribution { font-size: 10px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  (function () {
    var send = function (lat, lng) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ lat: lat, lng: lng }));
      }
    };

    var map = L.map('map', { zoomControl: true }).setView([${lat}, ${lng}], 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    var marker = L.marker([${lat}, ${lng}], { draggable: true }).addTo(map);
    var ring = L.circle([${lat}, ${lng}], {
      radius: ${radius}, color: '${colors.statusInfo}', weight: 1, fillOpacity: 0.08
    }).addTo(map);

    var move = function (latlng) {
      marker.setLatLng(latlng);
      ring.setLatLng(latlng);
      send(latlng.lat, latlng.lng);
    };

    map.on('click', function (e) { move(e.latlng); });
    marker.on('dragend', function () { move(marker.getLatLng()); });

    // Let React Native recentre the pin after a search.
    window.auraSetCenter = function (lat, lng) {
      var latlng = L.latLng(lat, lng);
      map.setView(latlng, 17);
      marker.setLatLng(latlng);
      ring.setLatLng(latlng);
    };
  })();
</script>
</body>
</html>`;
}

export function OsmMap({ latitude, longitude, onPick, radiusMeters = 150 }: Props) {
  const webviewRef = useRef<WebView>(null);
  const lastSentRef = useRef<string>("");

  // Rebuilding the HTML would reload the map, losing the traveller's zoom and
  // pan. Build it once from the opening position and push later moves in.
  const html = useMemo(
    () => buildHtml(latitude, longitude, radiusMeters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  if (key !== lastSentRef.current && webviewRef.current) {
    lastSentRef.current = key;
    webviewRef.current.injectJavaScript(
      `window.auraSetCenter && window.auraSetCenter(${latitude}, ${longitude}); true;`,
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(event) => {
          try {
            const { lat, lng } = JSON.parse(event.nativeEvent.data);
            if (typeof lat === "number" && typeof lng === "number") {
              lastSentRef.current = `${lat.toFixed(6)},${lng.toFixed(6)}`;
              onPick(lat, lng);
            }
          } catch {
            // A malformed message from the page is not worth surfacing.
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
  },
});
