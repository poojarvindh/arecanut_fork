import { useEffect, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Capacitor } from "@capacitor/core";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Undo2, AlertCircle, Navigation, X, Play, Square, RotateCcw } from "lucide-react";
import type { LatLngPoint, PlotBoundary } from "../../lib/plotBoundary";
import { areaInAcres, haversineMeters, formatArea } from "../../lib/plotBoundary";
import { t } from "../../i18n";
import { useLang } from "../../LangContext";

const TRACK_MAP_DEFAULT_CENTER = { lat: 13.9299, lng: 75.5681 }; // Shivamogga, Karnataka arecanut belt — same fallback as DrawMapTab

const LIVE_MARKER_ICON = L.divIcon({
  className: "",
  html: `<div style="width:16px;height:16px;border-radius:9999px;background:#2563EB;border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.4);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

interface Props {
  points: PlotBoundary;
  onChange: (points: PlotBoundary) => void;
}

type GpsMode = "corners" | "track";

// A GPS chip's very first fix after a cold/warm start is usually its worst —
// it often comes from a cell-tower/wifi estimate before the chip has had time
// to lock onto enough satellites. The old implementation called
// getCurrentPosition() once and accepted whatever came back, which is why
// field accuracy was inconsistent (sometimes ±3m, sometimes ±50m+ depending
// on how quickly that single fix arrived). This version instead watches for
// up to MAX_WAIT_MS, keeps the single best (lowest-accuracy) sample seen, and
// auto-accepts early once a genuinely good fix (<= TARGET_ACCURACY_M) shows
// up — so a clear-sky reading still returns quickly, but a noisy one gets a
// real chance to settle instead of being accepted on the first jittery read.
const MAX_WAIT_MS = 20000;
const TARGET_ACCURACY_M = 6;
const WARN_ACCURACY_M = 20; // accepted, but flagged — canopy/urban-canyon conditions can genuinely not do better than this

// Continuous "walk the perimeter" track mode: a point is only kept once the
// walker has moved at least the chosen step distance from the last kept
// point (GPS jitter while standing still would otherwise flood the polygon
// with noise right on top of itself), and any single reading noisier than
// MAX_TRACK_ACCURACY_M is dropped outright rather than letting one bad
// moment put a spike in the boundary. The step distance is user-selectable
// (not a fixed constant) because a small plot wants a fine spacing for
// shape accuracy, while a large (2+ acre) farm's perimeter is long enough
// that a fine spacing would mean thousands of points and a much longer
// walk — a wider spacing keeps the point count and capture time reasonable
// without materially hurting the area calculation for a bigger boundary.
const STEP_OPTIONS_M = [5, 10, 15, 25, 30, 50];
const DEFAULT_STEP_M = 5;
const MAX_TRACK_ACCURACY_M = 25;

// Genuinely shared across web and the Capacitor Android app — @capacitor/geolocation
// normalizes the underlying platform API (browser Geolocation on web, native
// GPS on Android), matching the cross-platform contract in the spec §6.
export default function GpsCaptureTab({ points, onChange }: Props) {
  const { lang } = useLang();
  const [mode, setMode] = useState<GpsMode>("corners");

  // --- "Tap Each Corner" mode state ---
  const [accuracyByIndex, setAccuracyByIndex] = useState<Record<number, number>>({});
  const [capturing, setCapturing] = useState(false);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const bestRef = useRef<{ point: LatLngPoint; accuracy: number } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // --- "Walk the Perimeter" track mode state ---
  const [tracking, setTracking] = useState(false);
  const [trackPoints, setTrackPoints] = useState<PlotBoundary>([]);
  const [trackSkipped, setTrackSkipped] = useState(0); // readings dropped for being too noisy — surfaced so a user in bad-signal terrain understands why progress looks slow
  const [stepMeters, setStepMeters] = useState(DEFAULT_STEP_M);
  const trackWatchIdRef = useRef<string | null>(null);
  const lastKeptRef = useRef<LatLngPoint | null>(null);

  // --- Walk the Perimeter live map (shows the user's current position and
  // the path walked so far, so they can see on-screen whether they're
  // actually tracing the real plot boundary rather than drifting off it) ---
  const [livePosition, setLivePosition] = useState<LatLngPoint | null>(null);
  const trackMapDivRef = useRef<HTMLDivElement>(null);
  const trackMapRef = useRef<L.Map | null>(null);
  const trackMarkerRef = useRef<L.Marker | null>(null);
  const trackPolylineRef = useRef<L.Polyline | null>(null);
  const trackPolygonRef = useRef<L.Polygon | null>(null);

  const isWeb = Capacitor.getPlatform() === "web";

  const requestLocationPermission = async (): Promise<boolean> => {
    try {
      const perm = await Geolocation.requestPermissions().catch(() => null);
      if (perm && perm.location === "denied") {
        setError("Location permission denied — enable it in your device/browser settings.");
        return false;
      }
    } catch {
      // requestPermissions can throw on some platforms even when permission is fine — proceed and let watchPosition itself report a real failure.
    }
    return true;
  };

  // ---------------- Tap Each Corner ----------------

  const finishCapture = async () => {
    if (watchIdRef.current) {
      await Geolocation.clearWatch({ id: watchIdRef.current }).catch(() => {});
      watchIdRef.current = null;
    }
    stopRef.current = null;
    setCapturing(false);
    setLiveAccuracy(null);

    const best = bestRef.current;
    bestRef.current = null;
    if (!best) {
      setError(t("No GPS fix was obtained — try again in an open area with better signal.", lang));
      return;
    }
    const nextIndex = points.length;
    onChange([...points, best.point]);
    setAccuracyByIndex((prev) => ({ ...prev, [nextIndex]: best.accuracy }));
    setLastAccuracy(best.accuracy);
  };

  const capture = async () => {
    setError(null);
    setLastAccuracy(null);

    if (isWeb && !window.isSecureContext) {
      setError("Location requires a secure connection (HTTPS) — this page is being served over plain HTTP.");
      return;
    }
    if (!(await requestLocationPermission())) return;

    bestRef.current = null;
    setLiveAccuracy(null);
    setCapturing(true);

    const timeoutId = setTimeout(() => finishCapture(), MAX_WAIT_MS);
    stopRef.current = () => {
      clearTimeout(timeoutId);
      finishCapture();
    };

    try {
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: MAX_WAIT_MS, maximumAge: 0, minimumUpdateInterval: 1000 },
        (pos, err) => {
          if (err || !pos) return; // a transient read failure mid-watch isn't fatal — keep waiting for the next tick
          const accuracy = pos.coords.accuracy;
          setLiveAccuracy(accuracy);
          if (!bestRef.current || accuracy < bestRef.current.accuracy) {
            bestRef.current = { point: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracy };
          }
          if (accuracy <= TARGET_ACCURACY_M) {
            clearTimeout(timeoutId);
            finishCapture();
          }
        }
      );
      watchIdRef.current = id;
    } catch (e: any) {
      clearTimeout(timeoutId);
      setCapturing(false);
      setLiveAccuracy(null);
      const code = e?.code;
      if (code === 1) setError("Location permission denied — enable it in your device/browser settings.");
      else setError(e?.message || "Could not get your location. Please try again.");
    }
  };

  const cancelCapture = () => {
    stopRef.current?.();
  };

  const undo = () => {
    onChange(points.slice(0, -1));
    setAccuracyByIndex((prev) => {
      const next = { ...prev };
      delete next[points.length - 1];
      return next;
    });
  };

  // ---------------- Walk the Perimeter live map ----------------

  // The map div unmounts whenever `mode` leaves "track" (conditional render
  // below), so the Leaflet instance tied to that div must be torn down and
  // recreated on the way back in — reusing a stale map/div pairing would
  // silently no-op every update.
  useEffect(() => {
    if (mode !== "track") {
      trackMapRef.current?.remove();
      trackMapRef.current = null;
      trackMarkerRef.current = null;
      trackPolylineRef.current = null;
      trackPolygonRef.current = null;
      return;
    }
    if (trackMapRef.current || !trackMapDivRef.current) return;
    const center = trackPoints[0] || TRACK_MAP_DEFAULT_CENTER;
    const map = L.map(trackMapDivRef.current, { center: [center.lat, center.lng], zoom: 18 });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }).addTo(map);
    // Esri's satellite tiles are pure imagery with no labels — this reference
    // overlay adds place names/roads/boundaries on top, matching Google's old
    // "hybrid" map type. Same approach as DrawMapTab.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      pane: "overlayPane",
    }).addTo(map);
    trackMapRef.current = map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Live position (every raw GPS fix, even ones dropped from the saved track
  // for being too close together) keeps the on-map marker moving smoothly so
  // the user can see they're tracking their actual position in real time.
  useEffect(() => {
    const map = trackMapRef.current;
    if (!livePosition || !map) return;
    const latlng: L.LatLngTuple = [livePosition.lat, livePosition.lng];
    if (!trackMarkerRef.current) {
      trackMarkerRef.current = L.marker(latlng, { icon: LIVE_MARKER_ICON, zIndexOffset: 999 }).addTo(map);
    } else {
      trackMarkerRef.current.setLatLng(latlng);
    }
    map.panTo(latlng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePosition]);

  // The walked path (only the kept/filtered points) redraws as a line, and
  // once there are enough points to close a shape, a translucent polygon
  // preview too — so the user can tell early whether the shape looks right.
  useEffect(() => {
    const map = trackMapRef.current;
    if (!map) return;
    trackPolylineRef.current?.remove();
    trackPolygonRef.current?.remove();
    trackPolylineRef.current = null;
    trackPolygonRef.current = null;
    const latlngs = trackPoints.map((p) => [p.lat, p.lng] as [number, number]);
    if (trackPoints.length >= 2) {
      trackPolylineRef.current = L.polyline(latlngs, { color: "#A6266E", weight: 3 }).addTo(map);
    }
    if (trackPoints.length >= 3) {
      trackPolygonRef.current = L.polygon(latlngs, { color: "#A6266E", weight: 2, fillColor: "#5A2D82", fillOpacity: 0.25 }).addTo(map);
    }
  }, [trackPoints]);

  // ---------------- Walk the Perimeter ----------------

  const startTracking = async () => {
    setError(null);
    if (isWeb && !window.isSecureContext) {
      setError("Location requires a secure connection (HTTPS) — this page is being served over plain HTTP.");
      return;
    }
    if (!(await requestLocationPermission())) return;

    setTrackPoints([]);
    setTrackSkipped(0);
    lastKeptRef.current = null;
    setTracking(true);

    try {
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 0, maximumAge: 0, minimumUpdateInterval: 1000 },
        (pos, err) => {
          if (err || !pos) return;
          const { latitude, longitude, accuracy } = pos.coords;
          const point: LatLngPoint = { lat: latitude, lng: longitude };
          setLivePosition(point); // every raw fix moves the on-map marker, regardless of the filters below
          if (accuracy > MAX_TRACK_ACCURACY_M) {
            setTrackSkipped((n) => n + 1);
            return;
          }
          if (lastKeptRef.current && haversineMeters(lastKeptRef.current, point) < stepMeters) {
            return; // hasn't moved far enough since the last kept point yet — standing still or walking very slowly
          }
          lastKeptRef.current = point;
          setTrackPoints((prev) => [...prev, point]);
        }
      );
      trackWatchIdRef.current = id;
    } catch (e: any) {
      setTracking(false);
      const code = e?.code;
      if (code === 1) setError("Location permission denied — enable it in your device/browser settings.");
      else setError(e?.message || "Could not start GPS tracking. Please try again.");
    }
  };

  const stopTrackingWatch = async () => {
    if (trackWatchIdRef.current) {
      await Geolocation.clearWatch({ id: trackWatchIdRef.current }).catch(() => {});
      trackWatchIdRef.current = null;
    }
    setTracking(false);
    setLivePosition(null);
    trackMarkerRef.current?.remove();
    trackMarkerRef.current = null;
  };

  const finishTrack = async () => {
    await stopTrackingWatch();
    if (trackPoints.length < 3) {
      setError(t("The walked path needs at least 3 distinct points to form a boundary — keep walking further around the plot and try again.", lang));
      return;
    }
    onChange(trackPoints); // a completed walk replaces the plot's boundary outright — it's the whole perimeter, not one more corner
    setTrackPoints([]);
    lastKeptRef.current = null;
  };

  const discardTrack = async () => {
    await stopTrackingWatch();
    setTrackPoints([]);
    setTrackSkipped(0);
    lastKeptRef.current = null;
  };

  const trackDistanceMeters = trackPoints.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + haversineMeters(trackPoints[i - 1], p)),
    0
  );
  const trackAreaAcres = trackPoints.length >= 3 ? areaInAcres(trackPoints) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {([
          { key: "corners" as const, label: "Tap Each Corner" },
          { key: "track" as const, label: "Walk the Perimeter" },
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            disabled={capturing || tracking}
            className={`flex-1 text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
              mode === m.key
                ? "gt-gradient text-white border-transparent shadow-sm"
                : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
            }`}
          >
            {t(m.label, lang)}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {mode === "corners" && (
        <>
          <div className="text-sm text-[var(--gt-text-muted)]">
            {t("Walk to each corner of the plot and tap \"Capture Current Point\" there. Capture at least 3 points, in order, to form the boundary.", lang)}
          </div>

          {lastAccuracy != null && lastAccuracy > WARN_ACCURACY_M && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg px-3 py-2">
              <AlertCircle size={16} /> {t("Last point's accuracy was only ±{n}m — that corner may be off. Step into open sky (away from trees/buildings) and tap \"Undo\" then recapture it if you can.", lang).replace("{n}", String(Math.round(lastAccuracy)))}
            </div>
          )}

          {capturing && (
            <div className="gt-card p-3 flex items-center justify-between gap-3 bg-[#F1EBF7] border-none">
              <div className="flex items-center gap-2 text-sm text-[var(--gt-purple-dark)]">
                <Navigation size={16} className="animate-pulse" />
                {liveAccuracy != null
                  ? t("Improving accuracy… current best ±{n}m", lang).replace("{n}", String(Math.round(liveAccuracy)))
                  : t("Getting a GPS fix…", lang)}
              </div>
              <button type="button" className="text-xs font-semibold text-[var(--gt-purple-dark)] underline flex items-center gap-1" onClick={cancelCapture}>
                <X size={12} /> {t("Use this reading now", lang)}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={capture} disabled={capturing}>
              <Navigation size={16} className={capturing ? "animate-pulse" : ""} /> {t(capturing ? "Capturing…" : "Capture Current Point", lang)}
            </button>
            <button className="gt-btn-secondary flex items-center gap-1.5" onClick={undo} disabled={points.length === 0 || capturing}>
              <Undo2 size={16} /> {t("Undo", lang)}
            </button>
          </div>

          {points.length > 0 && (
            <div className="gt-card p-3 max-h-64 overflow-y-auto">
              {points.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-[var(--gt-border)] last:border-none text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[var(--gt-purple)] text-white text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="font-mono text-xs">{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</span>
                  </div>
                  {accuracyByIndex[i] != null && (
                    <span className={`text-[11px] flex items-center gap-1 ${accuracyByIndex[i] > WARN_ACCURACY_M ? "text-amber-600 font-medium" : "text-[var(--gt-text-muted)]"}`}>
                      <MapPin size={11} /> ±{Math.round(accuracyByIndex[i])}m
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "track" && (
        <>
          <div className="text-sm text-[var(--gt-text-muted)]">
            {t("Stand at one corner, tap \"Start Walking\", then walk the full boundary of the plot once, in order, back to where you started. The system logs your position automatically as you go — no tapping needed per corner. Tap \"Finish\" once you've walked the whole perimeter.", lang)}
          </div>

          <div className="relative w-full rounded-xl border border-[var(--gt-border)] bg-[#F1EBF7]" style={{ height: 280 }}>
            {/* Same DOM-ownership caveat as DrawMapTab: Leaflet takes over this
                div directly once created, so it must stay free of React-rendered
                children — the placeholder below is an absolutely-positioned sibling. */}
            <div ref={trackMapDivRef} className="w-full h-full rounded-xl" />
            {!tracking && trackPoints.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--gt-text-muted)] bg-white/60 pointer-events-none px-4 text-center">
                {t("Tap \"Start Walking\" to see your live position and walked path here.", lang)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-[var(--gt-text)] whitespace-nowrap">{t("Capture a point every", lang)}</label>
            <select
              className="gt-input w-auto"
              value={stepMeters}
              onChange={(e) => setStepMeters(Number(e.target.value))}
              disabled={tracking}
            >
              {STEP_OPTIONS_M.map((m) => (
                <option key={m} value={m}>{m} {t("meters", lang)}</option>
              ))}
            </select>
            <span className="text-xs text-[var(--gt-text-muted)]">
              {t("Use a smaller spacing for a small/precise plot, a larger spacing for a bigger farm (fewer points, faster walk).", lang)}
            </span>
          </div>

          {tracking && (
            <div className="gt-card p-3 flex flex-col gap-2 bg-[#F1EBF7] border-none">
              <div className="flex items-center gap-2 text-sm text-[var(--gt-purple-dark)] font-medium">
                <Navigation size={16} className="animate-pulse" /> {t("Walking… keep moving along the boundary", lang)}
              </div>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <span><b>{trackPoints.length}</b> {t("points logged", lang)}</span>
                <span>{t("Distance walked:", lang)} <b>{Math.round(trackDistanceMeters)}m</b></span>
                {trackPoints.length >= 3 && <span>{t("Enclosed area so far:", lang)} <b>{formatArea(trackAreaAcres, lang)}</b></span>}
                <span className="text-xs text-[var(--gt-text-muted)]">{t("spacing:", lang)} {stepMeters}m</span>
                {trackSkipped > 0 && <span className="text-[var(--gt-text-muted)]">({trackSkipped} {t("noisy readings skipped", lang)})</span>}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {!tracking ? (
              <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={startTracking}>
                <Play size={16} /> {t("Start Walking", lang)}
              </button>
            ) : (
              <>
                <button className="gt-btn-primary flex items-center gap-2 flex-1 justify-center" onClick={finishTrack}>
                  <Square size={16} /> {t("Finish", lang)}
                </button>
                <button className="gt-btn-secondary flex items-center gap-1.5" onClick={discardTrack}>
                  <RotateCcw size={16} /> {t("Discard", lang)}
                </button>
              </>
            )}
          </div>

          {!tracking && points.length >= 3 && (
            <div className="gt-card p-3 flex items-center justify-between flex-wrap gap-2 text-sm">
              <span><b>{points.length}</b> {t("points in saved boundary", lang)}</span>
              <span className="text-[var(--gt-purple-dark)] font-semibold">{formatArea(areaInAcres(points), lang)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
