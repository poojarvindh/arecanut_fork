import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, History } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { api } from "../api";

// CR-18: lets a user compare one farmer's area/yield/production/quality across
// the years/seasons they've been surveyed in. The data model already keeps a
// separate row per survey (no uniqueness constraint on farmer_id, so a new
// season's entry never overwrites a prior one) — this view is the missing
// piece that actually lets someone look at that history side by side.
export default function FarmerHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const survey = await api.getSurvey(Number(id));
        setCurrent(survey);
        const all = await api.listSurveys({ farmer_id: survey.farmer_id, limit: "1000" });
        setRows(all);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ya = a.survey_year ?? new Date(a.entry_timestamp).getFullYear();
      const yb = b.survey_year ?? new Date(b.entry_timestamp).getFullYear();
      if (ya !== yb) return ya - yb;
      return new Date(a.entry_timestamp).getTime() - new Date(b.entry_timestamp).getTime();
    });
  }, [rows]);

  const chartData = useMemo(() => {
    return sorted.map((r) => {
      const production = (r.yield_raw_qtl || 0) + (r.yield_processed_qtl || 0);
      return {
        label: String(r.survey_year ?? new Date(r.entry_timestamp).getFullYear()),
        area: r.areca_area_acres || 0,
        production,
        yieldPerAcre: r.areca_area_acres ? Math.round((production / r.areca_area_acres) * 100) / 100 : 0,
        rate: r.rate_inr_per_kg || 0,
      };
    });
  }, [sorted]);

  if (loading) return <div className="text-center py-20 text-[var(--gt-text-muted)]">Loading history…</div>;
  if (error) return <div className="text-center py-20 text-[var(--gt-danger)]">{error}</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] flex items-center gap-2">
            <History size={20} /> Farmer History
          </h1>
          <p className="text-sm text-[var(--gt-text-muted)]">
            {current?.farmer_name} &middot; {current?.farmer_id} &middot; {sorted.length} survey{sorted.length === 1 ? "" : "s"} on record
          </p>
        </div>
        <button className="gt-btn-secondary flex items-center gap-1.5" onClick={() => navigate(`/farmers/${id}`)}>
          <ArrowLeft size={15} /> Back to Record
        </button>
      </div>

      {sorted.length <= 1 ? (
        <div className="gt-card p-4 text-sm text-[var(--gt-text-muted)]">
          Only one survey exists for this farmer so far — history comparison will show once a second season's survey is entered for the same Farmer Unique ID ({current?.farmer_id}).
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="gt-card p-4">
              <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Area &amp; Production (Qtl) by Year</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="area" name="Area (Acres)" stroke="#5A2D82" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="production" name="Production (Qtl)" stroke="#A6266E" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="gt-card p-4">
              <div className="font-semibold text-sm mb-2 text-[var(--gt-purple-dark)]">Yield (Qtl/Acre) &amp; Rate (INR/Kg) by Year</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="yieldPerAcre" name="Yield (Qtl/Acre)" stroke="#1D8A5B" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="rate" name="Rate (INR/Kg)" stroke="#C9821C" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="gt-card p-4 overflow-x-auto">
            <div className="font-semibold text-sm mb-3 text-[var(--gt-purple-dark)]">Season-by-Season Comparison</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
                  <th className="py-1.5 pr-3">Year / Season</th>
                  <th className="py-1.5 pr-3">Area (Acres)</th>
                  <th className="py-1.5 pr-3">Production (Qtl)</th>
                  <th className="py-1.5 pr-3">Yield (Qtl/Acre)</th>
                  <th className="py-1.5 pr-3">Sale Type</th>
                  <th className="py-1.5 pr-3">Rate (INR/Kg)</th>
                  <th className="py-1.5 pr-3">Quality / Grading</th>
                  <th className="py-1.5 pr-3">Net Income (INR)</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const production = (r.yield_raw_qtl || 0) + (r.yield_processed_qtl || 0);
                  const yieldPerAcre = r.areca_area_acres ? (production / r.areca_area_acres).toFixed(2) : "—";
                  const quality = r.grading_done === "Yes" ? "Graded" : r.organic_certified === "Yes" ? "Organic Certified" : "—";
                  return (
                    <tr key={r.id} className="border-b border-[var(--gt-border)] last:border-0 hover:bg-[#F6F4F9]">
                      <td className="py-1.5 pr-3 font-medium">{r.survey_year ?? new Date(r.entry_timestamp).getFullYear()}</td>
                      <td className="py-1.5 pr-3">{r.areca_area_acres}</td>
                      <td className="py-1.5 pr-3">{production || "—"}</td>
                      <td className="py-1.5 pr-3">{yieldPerAcre}</td>
                      <td className="py-1.5 pr-3">{r.sale_type}</td>
                      <td className="py-1.5 pr-3">{r.rate_inr_per_kg ?? "—"}</td>
                      <td className="py-1.5 pr-3">{quality}</td>
                      <td className="py-1.5 pr-3">₹{(r.total_income_inr || 0).toLocaleString("en-IN")}</td>
                      <td className="py-1.5">
                        <button className="text-[var(--gt-purple-dark)] underline text-xs" onClick={() => navigate(`/farmers/${r.id}`)}>View</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
