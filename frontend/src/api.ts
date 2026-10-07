// In the browser dev server, relative "/api" works via the Vite proxy.
// Packaged into the Android app there's no dev-server proxy, so the mobile
// build is compiled with VITE_API_BASE pointing at the backend's real host.
const BASE = import.meta.env.VITE_API_BASE || "/api";
const TOKEN_KEY = "gt_token";
const REFRESH_KEY = "gt_refresh_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}
export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

// Fired only once both the access token AND a silent refresh attempt have
// failed, so the app forces a re-login.
export const AUTH_EVENT = "gt-auth-expired";

async function rawFetch(path: string, options?: RequestInit, token?: string | null) {
  return fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
}

// Coalesces concurrent 401s into a single refresh call instead of firing one
// per in-flight request.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await rawFetch("/auth/refresh", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
        if (!res.ok) return false;
        const data = await res.json();
        setToken(data.access_token);
        setRefreshToken(data.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

const AUTH_ENDPOINTS = ["/auth/login", "/auth/refresh", "/auth/forgot-password", "/auth/reset-password"];

async function req(path: string, options?: RequestInit) {
  let res = await rawFetch(path, options, getToken());

  // A 401 from login itself (bad credentials) or from the other public auth
  // endpoints is a normal request failure, not an expired session — it must
  // fall through to the generic error handler below and show the backend's
  // actual message instead of "Session expired".
  if (res.status === 401 && !AUTH_ENDPOINTS.includes(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, options, getToken());
    } else {
      setToken(null);
      setRefreshToken(null);
      window.dispatchEvent(new Event(AUTH_EVENT));
      throw new Error("Session expired — please log in again.");
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: (refreshToken: string) => req("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }),
  me: () => req("/auth/me"),
  forgotPassword: (identifier: string) => req("/auth/forgot-password", { method: "POST", body: JSON.stringify({ identifier }) }),
  resetPassword: (token: string, newPassword: string) =>
    req("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, new_password: newPassword }) }),
  districts: () => req("/masters/districts"),
  talukas: (district: string) => req(`/masters/talukas?district=${encodeURIComponent(district)}`),
  villages: (district: string, taluka: string) =>
    req(`/masters/villages?district=${encodeURIComponent(district)}&taluka=${encodeURIComponent(taluka)}`),
  villagesFlat: (): Promise<{ village: string; taluka: string; district: string }[]> => req("/masters/villages-flat"),
  societies: (taluka?: string) => req(`/masters/societies${taluka ? `?taluka=${encodeURIComponent(taluka)}` : ""}`),
  crops: () => req("/masters/crops"),
  schemes: () => req("/masters/schemes"),
  machines: () => req("/masters/machines"),
  options: (listCode: string) => req(`/masters/options?list_code=${encodeURIComponent(listCode)}`),
  lookupFarmer: (q: string) => req(`/farmer-master/lookup?q=${encodeURIComponent(q)}`),
  listSurveys: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return req(`/surveys${qs}`);
  },
  // CR-19: downloadable Excel export of the Farmer Records list, honoring
  // whatever filters/sort are currently applied. Returns a Blob (not JSON),
  // so it can't go through req() — but reuses the same bearer-token +
  // one-retry-on-401 pattern so an expired access token doesn't just fail silently.
  exportSurveys: async (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    let res = await rawFetch(`/surveys/export${qs}`, undefined, getToken());
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) res = await rawFetch(`/surveys/export${qs}`, undefined, getToken());
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Export failed: ${res.status}`);
    }
    return res.blob();
  },
  getSurvey: (id: number) => req(`/surveys/${id}`),
  createSurvey: (data: any) => req("/surveys", { method: "POST", body: JSON.stringify(data) }),
  updateSurvey: (id: number, data: any) => req(`/surveys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSurvey: (id: number) => req(`/surveys/${id}`, { method: "DELETE" }),
  dashboardKpis: () => req("/dashboard/kpis"),
  yieldBenchmarks: () => req("/dashboard/yield-benchmarks"),
  getPlotBoundary: (surveyId: number) => req(`/surveys/${surveyId}/plot-boundary`),
  savePlotBoundary: (surveyId: number, data: { points: { lat: number; lng: number }[]; area_acres: number; method: string }) =>
    req(`/surveys/${surveyId}/plot-boundary`, { method: "PUT", body: JSON.stringify(data) }),
  deletePlotBoundary: (surveyId: number) => req(`/surveys/${surveyId}/plot-boundary`, { method: "DELETE" }),
  listPlots: (onlyWithBoundary = true) => req(`/plots?only_with_boundary=${onlyWithBoundary}`),
  listUsers: () => req("/users"),
  permissionModules: (): Promise<string[]> => req("/users/permission-modules"),
  createUser: (data: any) => req("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: any) => req(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  masterTables: () => req("/admin/master-data/tables"),
  masterRows: (table: string) => req(`/admin/master-data/${table}`),
  createMasterRow: (table: string, data: any) => req(`/admin/master-data/${table}`, { method: "POST", body: JSON.stringify(data) }),
  updateMasterRow: (table: string, id: number, data: any) => req(`/admin/master-data/${table}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMasterRow: (table: string, id: number) => req(`/admin/master-data/${table}/${id}`, { method: "DELETE" }),
  listFpoConsultations: (status?: string) => req(`/fpo-consultations${status ? `?status=${status}` : ""}`),
  getFpoConsultation: (id: number) => req(`/fpo-consultations/${id}`),
  createFpoConsultation: (data: any) => req("/fpo-consultations", { method: "POST", body: JSON.stringify(data) }),
  updateFpoConsultation: (id: number, data: any) => req(`/fpo-consultations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  submitFpoConsultation: (id: number) => req(`/fpo-consultations/${id}/submit`, { method: "POST" }),
  deleteFpoConsultation: (id: number) => req(`/fpo-consultations/${id}`, { method: "DELETE" }),
};
