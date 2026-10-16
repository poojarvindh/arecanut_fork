import { useEffect, useRef, useState } from "react";
import { Undo2, RotateCcw, CheckCircle2 } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { t } from "../../i18n";
import { useLang } from "../../LangContext";
import type { PlotBoundary } from "../../lib/plotBoundary";

interface Props {
  points: PlotBoundary;
  onChange: (points: PlotBoundary) => void;
}

const DEFAULT_CENTER = { lat: 13.9299, lng: 75.5681 }; // Shivamogga, Karnataka arecanut belt

const POLYGON_STYLE: L.PolylineOptions = { color: "#A6266E", weight: 2, fillColor: "#5A2D82", fillOpacity: 0.25 };

function vertexIcon(label: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:#5A2D82;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;border:2px solid white;">${label}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

// Web-only for now (the app runs as a Vite web build inside the Capacitor
// WebView too, so this same component already covers "web + the installed
// Android app" per the v1 stack decision — no react-native-maps split needed).
//
// Uses plain Leaflet (not react-leaflet's declarative components) because the
// map here takes ownership of its div and is mutated imperatively throughout
// (markers added one at a time, a polygon swapped for an editable one) — the
// same reason the old Google Maps version managed its div directly.
export default function DrawMapTab({ points, onChange }: Props) {
  const { lang } = useLang();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const pointsRef = useRef<PlotBoundary>(points);
  const [editable, setEditable] = useState(points.length >= 3);

  pointsRef.current = points;

  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const center = points[0] || DEFAULT_CENTER;
    const map = L.map(mapDivRef.current, { center: [center.lat, center.lng], zoom: points.length ? 18 : 16 });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }).addTo(map);
    // Esri's satellite tiles are pure imagery with no labels — this reference
    // overlay adds place names/roads/boundaries on top, matching Google's old
    // "hybrid" map type.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      pane: "overlayPane",
    }).addTo(map);
    mapRef.current = map;

    if (points.length >= 3) {
      enableEditablePolygon(points);
    } else {
      map.on("click", onMapClick);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onMapClick(e: L.LeafletMouseEvent) {
    addPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
  }

  function clearOverlays() {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    polygonRef.current?.remove();
    polygonRef.current = null;
  }

  function redrawPreview(pts: PlotBoundary) {
    polygonRef.current?.remove();
    polygonRef.current = null;
    if (pts.length >= 2 && mapRef.current) {
      polygonRef.current = L.polygon(
        pts.map((p) => [p.lat, p.lng] as [number, number]),
        POLYGON_STYLE
      ).addTo(mapRef.current);
    }
  }

  function addPoint(point: { lat: number; lng: number }) {
    const map = mapRef.current;
    if (!map) return;
    const next = [...pointsRef.current, point];
    onChange(next);
    const marker = L.marker([point.lat, point.lng], { icon: vertexIcon(next.length) }).addTo(map);
    markersRef.current.push(marker);
    redrawPreview(next);
  }

  function undo() {
    const next = pointsRef.current.slice(0, -1);
    onChange(next);
    markersRef.current.pop()?.remove();
    redrawPreview(next);
  }

  function syncBack(layer: L.Polygon) {
    const ring = (layer.getLatLngs()[0] as L.LatLng[]) || [];
    onChange(ring.map((ll) => ({ lat: ll.lat, lng: ll.lng })));
  }

  function enableEditablePolygon(pts: PlotBoundary) {
    const map = mapRef.current;
    if (!map) return;
    clearOverlays();
    map.off("click", onMapClick);
    const layer = L.polygon(
      pts.map((p) => [p.lat, p.lng] as [number, number]),
      POLYGON_STYLE
    ).addTo(map);
    // layer.pm (Leaflet-Geoman) gives drag-to-move-vertex, drag-a-midpoint-to-
    // insert-a-vertex, and right-click-a-vertex-to-remove-it for free.
    layer.pm.enable({ allowSelfIntersection: false });
    layer.on("pm:edit", () => syncBack(layer));
    layer.on("pm:markerdragend", () => syncBack(layer));
    layer.on("pm:vertexadded", () => syncBack(layer));
    layer.on("pm:vertexremoved", () => syncBack(layer));
    polygonRef.current = layer;
    setEditable(true);
  }

  function finishBoundary() {
    if (pointsRef.current.length < 3) return;
    enableEditablePolygon(pointsRef.current);
  }

  function redraw() {
    polygonRef.current?.pm.disable();
    clearOverlays();
    onChange([]);
    setEditable(false);
    mapRef.current?.on("click", onMapClick);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-[var(--gt-text-muted)]">
        {editable
          ? "Drag a corner to move it, drag a midpoint to add a vertex, or right-click a corner to delete it."
          : t("Tap the map to place each corner of the plot, in order. At least 3 points are needed.", lang)}
      </div>

      <div className="relative w-full rounded-xl border border-[var(--gt-border)] bg-[#F1EBF7]" style={{ height: 360 }}>
        <div ref={mapDivRef} className="w-full h-full rounded-xl" />
      </div>

      <div className="flex gap-2">
        {!editable ? (
          <>
            <button className="gt-btn-secondary flex items-center gap-1.5" onClick={undo} disabled={points.length === 0}>
              <Undo2 size={15} /> {t("Undo", lang)}
            </button>
            <button className="gt-btn-primary flex items-center gap-1.5" onClick={finishBoundary} disabled={points.length < 3}>
              <CheckCircle2 size={15} /> {t("Finish Boundary", lang)}
            </button>
          </>
        ) : (
          <button className="gt-btn-secondary flex items-center gap-1.5" onClick={redraw}>
            <RotateCcw size={15} /> {t("Redraw", lang)}
          </button>
        )}
      </div>
    </div>
  );
}
