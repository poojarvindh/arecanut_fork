import { useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Capacitor } from "@capacitor/core";
import { MapPin, Undo2, AlertCircle, Navigation, X } from "lucide-react";
import type { LatLngPoint, PlotBoundary } from "../../lib/plotBoundary";
import { t } from "../../i18n";
import { useLang } from "../../LangContext";

interface Props {
  points: PlotBoundary;
  onChange: (points: PlotBoundary) => void;
}

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

// Genuinely shared across web and the Capacitor Android app — @capacitor/geolocation
// normalizes the underlying platform API (browser Geolocation on web, native
// GPS on Android), matching the cross-platform contract in the spec §6.
export default function GpsCaptureTab({ points, onChange }: Props) {
  const { lang } = useLang();
  const [accuracyByIndex, setAccuracyByIndex] = useState<Record<number, number>>({});
  const [capturing, setCapturing] = useState(false);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const bestRef = useRef<{ point: LatLngPoint; accuracy: number } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const isWeb = Capacitor.getPlatform() === "web";

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

    try {
      const perm = await Geolocation.requestPermissions().catch(() => null);
      if (perm && perm.location === "denied") {
        setError("Location permission denied — enable it in your device/browser settings.");
        return;
      }
    } catch {
      // requestPermissions can throw on some platforms even when permission is fine — proceed and let watchPosition itself report a real failure.
    }

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

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-[var(--gt-text-muted)]">
        {t("Walk to each corner of the plot and tap \"Capture Current Point\" there. Capture at least 3 points, in order, to form the boundary.", lang)}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

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
    </div>
  );
}
