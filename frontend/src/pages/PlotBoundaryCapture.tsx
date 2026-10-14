import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapPin, UploadCloud, Navigation, ArrowLeft, Save, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import DrawMapTab from "../components/plot/DrawMapTab";
import ExcelUploadTab from "../components/plot/ExcelUploadTab";
import GpsCaptureTab from "../components/plot/GpsCaptureTab";
import { areaInAcres, formatArea, validateBoundary, type CaptureMethod, type PlotBoundary } from "../lib/plotBoundary";

const METHODS: { key: CaptureMethod; label: string; icon: any }[] = [
  { key: "draw", label: "Draw on Map", icon: MapPin },
  { key: "excel", label: "Upload Excel", icon: UploadCloud },
  { key: "gps", label: "GPS Capture", icon: Navigation },
];

export default function PlotBoundaryCapture() {
  const { id } = useParams();
  const surveyId = Number(id);
  const navigate = useNavigate();

  const [survey, setSurvey] = useState<any>(null);
  const [method, setMethod] = useState<CaptureMethod>("draw");
  const [points, setPoints] = useState<PlotBoundary>([]);
  const [hasUnsavedEdit, setHasUnsavedEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getSurvey(surveyId).then(setSurvey).catch(() => {});
    api
      .getPlotBoundary(surveyId)
      .then((b) => {
        if (b?.points?.length) {
          setPoints(b.points);
          setMethod(b.method || "draw");
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [surveyId]);

  const area = areaInAcres(points);
  const validation = validateBoundary(points);

  const switchMethod = (next: CaptureMethod) => {
    if (next === method) return;
    if (points.length > 0 && hasUnsavedEdit) {
      const ok = window.confirm("Switching methods will discard the in-progress, unsaved boundary from this tab. Continue?");
      if (!ok) return;
    }
    setPoints([]);
    setHasUnsavedEdit(false);
    setSaved(false);
    setMethod(next);
  };

  const handleChange = (next: PlotBoundary) => {
    setPoints(next);
    setHasUnsavedEdit(true);
    setSaved(false);
  };

  const save = async () => {
    setError(null);
    const v = validateBoundary(points);
    if (!v.valid) {
      setError(v.error || "Invalid boundary.");
      return;
    }
    setSaving(true);
    try {
      await api.savePlotBoundary(surveyId, { points, area_acres: area, method });
      setSaved(true);
      setHasUnsavedEdit(false);
    } catch (e: any) {
      setError(e.message || "Could not save the boundary.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = window.confirm("Delete this plot's saved boundary?");
    if (!ok) return;
    await api.deletePlotBoundary(surveyId);
    setPoints([]);
    setSaved(false);
  };

  if (!loaded) return <div className="text-center py-20 text-[var(--gt-text-muted)]">Loading…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">Plot Boundary Capture</h1>
          <p className="text-sm text-[var(--gt-text-muted)]">
            {survey ? `${survey.farmer_name} · ${survey.village}, ${survey.taluka}` : `Survey #${surveyId}`}
          </p>
        </div>
        <button className="gt-btn-secondary flex items-center gap-1.5" onClick={() => navigate(`/farmers/${surveyId}`)}>
          <ArrowLeft size={15} /> Back to Farmer
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {METHODS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => switchMethod(key)}
            className={`shrink-0 flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full border whitespace-nowrap transition-colors ${
              method === key
                ? "gt-gradient text-white border-transparent shadow-sm"
                : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="gt-card p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 text-sm">
          <span><b>{points.length}</b> vertices</span>
          <span className="text-[var(--gt-purple-dark)] font-semibold">{formatArea(area)}</span>
        </div>
        {survey?.areca_area_acres && points.length >= 3 && (
          <span className="text-xs text-[var(--gt-text-muted)]">
            Declared areca area: {survey.areca_area_acres} acres
          </span>
        )}
      </div>

      {survey?.areca_area_acres > 0 && points.length >= 3 && (() => {
        const diffPct = Math.abs(area - survey.areca_area_acres) / survey.areca_area_acres * 100;
        if (diffPct <= 10) return null;
        return (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-lg px-3 py-2.5">
            <AlertCircle size={16} />
            GPS-measured area ({formatArea(area)}) differs from the declared area ({survey.areca_area_acres} acres) by {Math.round(diffPct)}%.
            {points.length === 3
              ? " Only 3 points were captured — if the actual plot has 4+ corners, a 3-point boundary can undercount the area by roughly half. Make sure every real corner of the plot was walked, not just 3."
              : " Double-check the boundary was walked around the full perimeter, in order, without skipping a corner."}
          </div>
        );
      })()}

      <div className="gt-card p-4 md:p-6">
        {method === "draw" && <DrawMapTab points={points} onChange={handleChange} />}
        {method === "excel" && <ExcelUploadTab onParsed={handleChange} />}
        {method === "gps" && <GpsCaptureTab points={points} onChange={handleChange} />}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-sm rounded-lg px-3 py-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2">
          <CheckCircle2 size={16} /> Boundary saved — {formatArea(area)} across {points.length} points.
        </div>
      )}

      <div className="flex justify-between gap-3">
        <button className="gt-btn-secondary flex items-center gap-1.5 text-[var(--gt-danger)]" onClick={remove} disabled={points.length === 0}>
          <Trash2 size={15} /> Delete Boundary
        </button>
        <button className="gt-btn-primary flex items-center gap-1.5" onClick={save} disabled={!validation.valid || saving}>
          <Save size={15} /> {saving ? "Saving…" : "Save Boundary"}
        </button>
      </div>
    </div>
  );
}
