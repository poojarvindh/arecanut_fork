import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, X, CloudUpload, Download, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { api } from "../api";
import { useLang } from "../LangContext";
import { tr, trDistrict, trTaluka, trVillage } from "../i18n";

// CR-19: columns the Farmer Records table can be sorted by, matching the
// backend's SORTABLE_FIELDS whitelist — keep these in sync with main.py.
const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "farmer_name", label: "Farmer" },
  { key: "village", label: "Village" },
  { key: "district", label: "District" },
  { key: "areca_area_acres", label: "Areca Area" },
  { key: "yield_raw_qtl", label: "Yield (Qtl)" },
  { key: "total_income_inr", label: "Net Income" },
];

export default function FarmerList() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang } = useLang();
  const justQueued = searchParams.get("queued") === "1";
  const sortBy = searchParams.get("sort_by") || "entry_timestamp";
  const sortDir = searchParams.get("sort_dir") === "asc" ? "asc" : "desc";

  const filterParams = useMemo(() => {
    const obj: Record<string, string> = {};
    searchParams.forEach((v, k) => { if (k !== "queued") obj[k] = v; });
    return obj;
  }, [searchParams]);

  const load = () => {
    const params = { ...filterParams, ...(q ? { q } : {}) };
    api.listSurveys(Object.keys(params).length ? params : undefined).then(setRows).catch(console.error);
  };

  const toggleSort = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (sortBy === key) {
      next.set("sort_dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      next.set("sort_by", key);
      next.set("sort_dir", "asc");
    }
    setSearchParams(next);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const params = { ...filterParams, ...(q ? { q } : {}) };
      const blob = await api.exportSurveys(Object.keys(params).length ? params : undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `farmer_surveys_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(e.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const clearFilters = () => {
    setSearchParams({});
    setQ("");
  };

  const removeFilter = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next);
  };

  const activeFilters = Object.entries(filterParams).filter(([k]) => k !== "sort_by" && k !== "sort_dir");

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold text-[var(--gt-purple-dark)]">{tr("farmerListTitle", lang)}</h1>
        <p className="text-sm text-[var(--gt-text-muted)]">{rows.length} {tr("records", lang)}</p>
      </div>

      {justQueued && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg px-3 py-2">
          <CloudUpload size={14} /> Saved on this device — it will sync automatically once you're back online.
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--gt-text-muted)] font-medium">{tr("filteredBy", lang)}:</span>
          {activeFilters.map(([key, value]) => (
            <span key={key} className="gt-chip active !cursor-default text-xs px-2.5 py-1">
              {key.replace(/_/g, " ")}: {value}
              <X size={12} className="cursor-pointer" onClick={() => removeFilter(key)} />
            </span>
          ))}
          <button className="text-xs text-[var(--gt-purple)] underline font-medium" onClick={clearFilters}>
            {tr("clearFilters", lang)}
          </button>
        </div>
      )}

      {exportError && (
        <div className="flex items-center gap-2 bg-red-50 border border-[var(--gt-danger)]/30 text-[var(--gt-danger)] text-xs rounded-lg px-3 py-2">
          {exportError}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gt-text-muted)]" />
          <input
            className="gt-input pl-9"
            placeholder={tr("searchPlaceholder", lang)}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </div>
        <button className="gt-btn-secondary" onClick={load}>{tr("search", lang)}</button>
        <button className="gt-btn-secondary flex items-center gap-1.5" onClick={handleExport} disabled={exporting}>
          <Download size={15} /> {exporting ? "Exporting…" : "Download Excel"}
        </button>
      </div>

      <div className="gt-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
              {SORT_COLUMNS.map(({ key, label }) => (
                <th key={key} className="p-3 cursor-pointer select-none hover:text-[var(--gt-purple-dark)]" onClick={() => toggleSort(key)}>
                  <span className="inline-flex items-center gap-1">
                    {key === "village" ? <>{tr("village", lang)} / {tr("taluka", lang)}</> : key === "district" ? tr("district", lang) : label}
                    {sortBy === key ? (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="opacity-30" />}
                  </span>
                </th>
              ))}
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--gt-border)] hover:bg-[#F6F4F9] cursor-pointer" onClick={() => navigate(`/farmers/${r.id}`)}>
                <td className="p-3">
                  <div className="font-medium">{r.farmer_name}</div>
                  <div className="text-xs text-[var(--gt-text-muted)]">{r.farmer_id} &middot; {r.mobile_no}</div>
                </td>
                <td className="p-3">{trVillage(r.village, lang)} / {trTaluka(r.taluka, lang)}</td>
                <td className="p-3">{trDistrict(r.district, lang)}</td>
                <td className="p-3">{r.areca_area_acres} ac</td>
                <td className="p-3">{r.yield_raw_qtl}</td>
                <td className="p-3 font-semibold text-[var(--gt-purple-dark)]">
                  {r.total_income_inr.toLocaleString("en-IN")}
                </td>
                <td className="p-3">
                  <button
                    className="text-[var(--gt-purple)] text-xs font-semibold underline"
                    onClick={(e) => { e.stopPropagation(); navigate(`/entry/farmer?id=${r.id}`); }}
                  >
                    {tr("edit", lang)}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-[var(--gt-text-muted)]">{tr("noRecords", lang)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
