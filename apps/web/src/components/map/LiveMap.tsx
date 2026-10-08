"use client";

import "leaflet/dist/leaflet.css";

import type { Circle, Map as LeafletMap, Marker } from "leaflet";
import { useEffect, useRef, type ReactNode } from "react";

export interface MapPoint {
  lat: number;
  lng: number;
  accuracy_m: number;
}

interface LiveMapProps {
  point: MapPoint | null;
  /** A position from a mock-location app: a red dot, framed together with the real one. */
  fake?: MapPoint | null;
  /** No fresh fix for a while: the dot greys out instead of glowing. */
  paused: boolean;
  /** Text equivalent of what the map shows (the map itself is not the only carrier). */
  label: string;
}

interface Spot {
  marker: Marker;
  circle: Circle;
}

interface Layers {
  map: LeafletMap;
  real: Spot;
  fake: Spot;
  framed: string; // which dots were last framed; a change re-frames the view once
}

// OpenStreetMap's standard tiles: no key, attribution required, fine for light use (see the
// OSM tile usage policy; a busy deployment should move to a paid or self-hosted tile server).
// globals.css tones them down to the app's palette and re-lights them for dark mode.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CAMPUS: [number, number] = [30.2687, 77.9947]; // Graphic Era, Dehradun: until the first fix
const CLOSE_ZOOM = 16;

function put(map: LeafletMap, { marker, circle }: Spot, point: MapPoint | null): void {
  if (!point) {
    marker.remove();
    circle.remove();
    return;
  }
  const at: [number, number] = [point.lat, point.lng];
  marker.setLatLng(at).addTo(map);
  circle.setLatLng(at).setRadius(Math.max(point.accuracy_m, 5)).addTo(map);
}

/** Move the dots; frame them when one appears or vanishes, or when one leaves the view. */
function place(
  layers: Layers,
  point: MapPoint | null,
  fake: MapPoint | null,
  paused: boolean,
): void {
  const { map } = layers;
  put(map, layers.real, point);
  put(map, layers.fake, fake);
  layers.real.marker.getElement()?.classList.toggle("is-paused", paused);
  const at = [point, fake]
    .filter((p): p is MapPoint => p !== null)
    .map((p): [number, number] => [p.lat, p.lng]);
  if (at.length === 0) return;
  const key = `${point ? "r" : ""}${fake ? "f" : ""}`;
  const fits = at.every((ll) => map.getBounds().pad(-0.15).contains(ll));
  if (key === layers.framed && fits) return;
  const jump = key !== layers.framed;
  layers.framed = key;
  if (at.length > 1) map.fitBounds(at, { padding: [36, 36], maxZoom: CLOSE_ZOOM, animate: !jump });
  else if (jump) map.setView(at[0], CLOSE_ZOOM, { animate: false });
  else map.panTo(at[0]);
}

/**
 * One live dot with its accuracy circle. Leaflet (~40 KB gzip) is imported only once this
 * component mounts, so no other screen pays for it, and it never runs during server rendering.
 */
export function LiveMap({ point, fake = null, paused, label }: LiveMapProps): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const layers = useRef<Layers | null>(null);
  const latest = useRef({ point, fake, paused });

  useEffect(() => {
    latest.current = { point, fake, paused };
    if (layers.current) place(layers.current, point, fake, paused);
  }, [point, fake, paused]);

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const map = L.map(container.current).setView(CAMPUS, 13);
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: "live-tiles" }).addTo(
        map,
      );
      const spot = (kind: string): Spot => ({
        marker: L.marker(CAMPUS, {
          icon: L.divIcon({ className: `live-dot ${kind}`, iconSize: [22, 22] }),
          keyboard: false,
          interactive: false,
        }),
        circle: L.circle(CAMPUS, {
          radius: 5,
          className: `live-accuracy ${kind}`,
          interactive: false,
        }),
      });
      layers.current = { map, real: spot(""), fake: spot("is-fake"), framed: "" };
      const { point, fake, paused } = latest.current;
      place(layers.current, point, fake, paused);
      // The box can still be settling (styles arriving, fonts, a rotation). Leaflet caches its
      // size, so tell it, and frame the dots again: fitting two dots depends on the real size.
      resize = new ResizeObserver(() => {
        if (!layers.current) return;
        map.invalidateSize({ animate: false });
        layers.current.framed = "";
        const now = latest.current;
        place(layers.current, now.point, now.fake, now.paused);
      });
      resize.observe(container.current);
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
      layers.current?.map.remove();
      layers.current = null;
    };
  }, []);

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        ref={container}
        role="region"
        aria-label={label}
        className="live-map h-72 w-full overflow-hidden rounded-sheet border border-line bg-accent-soft sm:h-80"
      />
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
