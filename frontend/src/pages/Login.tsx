import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Sprout, WifiOff, AlertCircle } from "lucide-react";
import { useAuth } from "../AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = !navigator.onLine;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errs: { username?: string; password?: string } = {};
    if (!username.trim()) errs.username = "Username is required.";
    if (!password) errs.password = "Password is required.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      await login(username, password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center gt-gradient p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-2xl gt-gradient text-white flex items-center justify-center">
            <Sprout size={28} />
          </div>
          <div className="text-lg font-bold text-[var(--gt-purple-dark)]">Madhyastha</div>
          <div className="text-xs text-[var(--gt-text-muted)]">Karnataka · NCCF Data Collection</div>
        </div>

        {offline && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2 mb-4">
            <WifiOff size={14} /> You're offline — sign in once to cache your session, then the app works in the field without signal.
          </div>
        )}

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div>
            <label className="gt-label">Username</label>
            <div className={fieldErrors.username ? "field-error" : ""}>
              <input
                className="gt-input"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setFieldErrors((f) => ({ ...f, username: undefined })); }}
                autoFocus
              />
            </div>
            {fieldErrors.username && (
              <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
                <AlertCircle size={12} /> {fieldErrors.username}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="gt-label !mb-0">Password</label>
              <Link to="/forgot-password" className="text-xs text-[var(--gt-purple)] font-medium underline mb-1">
                Forgot password?
              </Link>
            </div>
            <div className={fieldErrors.password ? "field-error" : ""}>
              <input
                type="password"
                className="gt-input"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); }}
              />
            </div>
            {fieldErrors.password && (
              <div className="flex items-center gap-1 text-xs text-[var(--gt-danger)] mt-1">
                <AlertCircle size={12} /> {fieldErrors.password}
              </div>
            )}
          </div>
          {error && (
            <div className="flex items-center gap-1.5 text-sm text-[var(--gt-danger)] bg-red-50 border border-[var(--gt-danger)]/30 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button className="gt-btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="text-[10px] text-[var(--gt-text-muted)] mt-4 text-center opacity-70">
          System last updated: {new Date(__BUILD_TIME__).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        </div>
      </div>
    </div>
  );
}
