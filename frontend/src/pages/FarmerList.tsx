import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, X, CloudUpload } from "lucide-react";
import { api } from "../api";
import { useLang } from "../LangContext";
import { tr, trDistrict, trTaluka, trVillage } from "../i18n";

export default function FarmerList() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang } = useLang();
  const justQueued = searchParams.get("queued") === "1";

  const filterParams = useMemo(() => {
    const obj: Record<string, string> = {};
    searchParams.forEach((v, k) => { if (k !== "queued") obj[k] = v; });
    return obj;
  }, [searchParams]);

  const load = () => {
    const params = { ...filterParams, ...(q ? { q } : {}) };
    api.listSurveys(Object.keys(params).length ? params : undefined).then(setRows).catch(console.error);
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

  const activeFilters = Object.entries(filterParams);

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
      </div>

      <div className="gt-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
              <th className="p-3">Farmer</th>
              <th className="p-3">{tr("village", lang)} / {tr("taluka", lang)}</th>
              <th className="p-3">{tr("district", lang)}</th>
              <th className="p-3">Areca Area</th>
              <th className="p-3">Yield (Qtl)</th>
              <th className="p-3">Net Income (₹)</th>
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
