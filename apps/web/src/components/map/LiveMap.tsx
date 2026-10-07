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
  /** No fresh fix for a while: the dot greys out instead of glowing. */
  paused: boolean;
  /** Text equivalent of what the map shows (the map itself is not the only carrier). */
  label: string;
}

interface Layers {
  map: LeafletMap;
  marker: Marker;
  circle: Circle;
}

// OpenStreetMap's standard tiles: no key, attribution required, fine for light use (see the
// OSM tile usage policy; a busy deployment should move to a paid or self-hosted tile server).
// globals.css tones them down to the app's palette and re-lights them for dark mode.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CAMPUS: [number, number] = [30.2687, 77.9947]; // Graphic Era, Dehradun: until the first fix
const CLOSE_ZOOM = 16;

/** Move the dot and its accuracy circle; re-centre on the first fix or when it leaves view. */
function place(layers: Layers, point: MapPoint | null, paused: boolean, first: boolean): void {
  const { map, marker, circle } = layers;
  if (!point) {
    marker.remove();
    circle.remove();
    return;
  }
  const at: [number, number] = [point.lat, point.lng];
  const wasHidden = !map.hasLayer(marker);
  marker.setLatLng(at).addTo(map);
  circle.setLatLng(at).setRadius(Math.max(point.accuracy_m, 5)).addTo(map);
  marker.getElement()?.classList.toggle("is-paused", paused);
  if (first || wasHidden) map.setView(at, CLOSE_ZOOM, { animate: false });
  else if (!map.getBounds().pad(-0.15).contains(at)) map.panTo(at);
}

/**
 * One live dot with its accuracy circle. Leaflet (~40 KB gzip) is imported only once this
 * component mounts, so no other screen pays for it, and it never runs during server rendering.
 */
export function LiveMap({ point, paused, label }: LiveMapProps): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const layers = useRef<Layers | null>(null);
  const latest = useRef({ point, paused });

  useEffect(() => {
    latest.current = { point, paused };
    if (layers.current) place(layers.current, point, paused, false);
  }, [point, paused]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const map = L.map(container.current).setView(CAMPUS, 13);
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: "live-tiles" }).addTo(
        map,
      );
      layers.current = {
        map,
        marker: L.marker(CAMPUS, {
          icon: L.divIcon({ className: "live-dot", iconSize: [22, 22] }),
          keyboard: false,
          interactive: false,
        }),
        circle: L.circle(CAMPUS, { radius: 5, className: "live-accuracy", interactive: false }),
      };
      place(layers.current, latest.current.point, latest.current.paused, true);
    });
    return () => {
      cancelled = true;
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
