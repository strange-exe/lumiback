import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useColorScheme, View } from "react-native";
import { WebView } from "react-native-webview";

import { WEB_URL } from "@/lib/config";
import { T } from "@/ui/kit";
import { radius, space, useColors, type Colors } from "@/ui/theme";

export interface MapPoint {
  lat: number;
  lng: number;
  accuracy_m: number;
}

/**
 * The same map as the web app: Leaflet with OpenStreetMap's standard tiles (no key, attribution
 * required), toned to the palette. Leaflet loads from a CDN pinned by integrity hash, so a
 * tampered file is refused. Runs in a WebView because the native map SDKs need either an API key
 * (Google) or extra native setup for a map we only use to show one dot.
 */
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const CAMPUS = [30.2687, 77.9947]; // Graphic Era, Dehradun: until the first fix

function page(c: Colors, dark: boolean): string {
  const tiles = dark
    ? "invert(1) hue-rotate(180deg) saturate(0.35) brightness(0.85) contrast(0.9)"
    : "saturate(0.45) sepia(0.12) brightness(1.03)";
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${LEAFLET_CSS_SRI}" crossorigin="">
<style>
  html,body,#map{margin:0;height:100%;background:${c.surface}}
  .tiles{filter:${tiles}}
  .leaflet-control-attribution{background:${c.surface}e0!important;color:${c.muted};font:11px sans-serif}
  .leaflet-control-attribution a{color:${c.accent}}
  .dot{border-radius:50%;background:${c.accent};border:3px solid ${c.surface};
    box-shadow:0 0 0 6px ${c.accent}4d,0 2px 6px rgba(0,0,0,.3);animation:halo 2.4s ease-out infinite}
  .dot.paused{background:${c.muted};box-shadow:0 2px 6px rgba(0,0,0,.3);animation:none}
  .dot.fake{background:${c.danger};box-shadow:0 0 0 6px ${c.danger}4d,0 2px 6px rgba(0,0,0,.3);animation:none}
  @keyframes halo{0%{box-shadow:0 0 0 0 ${c.accent}80,0 2px 6px rgba(0,0,0,.3)}
    100%{box-shadow:0 0 0 18px ${c.accent}00,0 2px 6px rgba(0,0,0,.3)}}
  @media (prefers-reduced-motion:reduce){.dot{animation:none}}
</style></head><body><div id="map"></div>
<script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin=""></script>
<script>
  var map = L.map('map', {zoomControl:false, attributionControl:true}).setView(${JSON.stringify(CAMPUS)}, 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, className:'tiles',
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  function spot(cls, color) {
    return {
      marker: L.marker([0, 0], {icon: L.divIcon({className: cls, iconSize: [22, 22]}), keyboard: false}),
      circle: L.circle([0, 0], {radius: 1, color: color, weight: 1.5, opacity: .45,
        fillColor: color, fillOpacity: .12, interactive: false}),
    };
  }
  function put(s, p) {
    if (!p) { s.marker.remove(); s.circle.remove(); return; }
    var ll = [p.lat, p.lng];
    s.marker.setLatLng(ll).addTo(map); s.circle.setLatLng(ll).setRadius(p.accuracy_m).addTo(map);
  }
  var real = spot('dot', '${c.accent}'), fake = spot('dot fake', '${c.danger}'), framed = '';
  // p: the real position; f: a position faked by a mock-location app (shown in red).
  window.place = function (p, paused, f) {
    put(real, p); put(fake, f);
    if (p && real.marker.getElement()) real.marker.getElement().classList.toggle('paused', !!paused);
    var pts = [p, f].filter(Boolean).map(function (q) { return [q.lat, q.lng]; });
    if (!pts.length) return;
    var key = pts.length + (f ? 'f' : '');
    if (key !== framed) { // first fix, or a dot appeared/vanished: frame everything once
      framed = key;
      if (pts.length > 1) map.fitBounds(pts, {padding: [36, 36], maxZoom: 16}); else map.setView(pts[0], 16);
    } else if (!pts.every(function (ll) { return map.getBounds().pad(-0.2).contains(ll); })) {
      if (pts.length > 1) map.fitBounds(pts, {padding: [36, 36], maxZoom: 16}); else map.panTo(pts[0]);
    }
  };
  window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;
}

/**
 * A live dot on a map. `paused` greys the dot (stale or not sending). `fake` adds a red dot for
 * a position from a mock-location app, framed together with the real one.
 */
export function LiveMap({
  point,
  fake = null,
  paused = false,
  height = 260,
  label,
}: {
  point: MapPoint | null;
  fake?: MapPoint | null;
  paused?: boolean;
  height?: number;
  /** Text equivalent for screen readers, e.g. "Abhinesh's location, updated 1 min ago". */
  label: string;
}): ReactNode {
  const c = useColors();
  const dark = useColorScheme() === "dark";
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => page(c, dark), [c, dark]);

  useEffect(() => {
    if (!ready || (!point && !fake)) return;
    const clip = (q: MapPoint | null) =>
      q && { lat: q.lat, lng: q.lng, accuracy_m: Math.min(q.accuracy_m, 2000) };
    const args = [clip(point), paused, clip(fake)].map((a) => JSON.stringify(a)).join(",");
    web.current?.injectJavaScript(`window.place(${args});true;`);
  }, [ready, point, fake, paused]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        height,
        borderRadius: radius.sheet,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.surface,
      }}
    >
      {failed ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space(5) }}
        >
          <T tone="small" style={{ textAlign: "center" }}>
            The map couldn&apos;t load. Check your connection.
          </T>
        </View>
      ) : (
        <WebView
          key={html} // theme change: reload with the new palette
          ref={web}
          originWhitelist={["*"]}
          // Base URL gives OSM's tile servers a proper Referer, as their usage policy asks.
          source={{ html, baseUrl: WEB_URL }}
          onMessage={(e) => e.nativeEvent.data === "ready" && setReady(true)}
          onLoadStart={() => setReady(false)}
          onError={() => setFailed(true)}
          style={{ backgroundColor: c.surface }}
          scrollEnabled={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled={false}
          importantForAccessibility="no-hide-descendants"
        />
      )}
    </View>
  );
}
