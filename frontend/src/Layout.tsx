import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, ClipboardList, PlusCircle, Users, Languages, WifiOff, RefreshCw, LogOut, UserCircle, Map, ShieldCheck, MoreHorizontal } from "lucide-react";
import { useLang } from "./LangContext";
import { tr } from "./i18n";
import { useAuth } from "./AuthContext";
import { pendingCount, syncQueue, attachAutoSync } from "./offlineQueue";

function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = () => pendingCount().then(setPending);

  useEffect(() => {
    refreshPending();
    const onOnline = () => { setOnline(true); refreshPending(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    attachAutoSync(() => refreshPending());
    const interval = setInterval(refreshPending, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, []);

  const manualSync = async () => {
    setSyncing(true);
    await syncQueue();
    await refreshPending();
    setSyncing(false);
  };

  if (online && pending === 0) return null;

  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full ${online ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-white/15 text-white"}`}>
      {!online && <WifiOff size={12} />}
      {online && pending > 0 && <span>{pending} pending sync</span>}
      {!online && <span>Offline{pending > 0 ? ` · ${pending} queued` : ""}</span>}
      {online && pending > 0 && (
        <button type="button" onClick={manualSync} disabled={syncing} className="underline">
          <RefreshCw size={11} className={`inline mr-0.5 ${syncing ? "animate-spin" : ""}`} /> Sync
        </button>
      )}
    </div>
  );
}

export default function Layout() {
  const { lang, toggle } = useLang();
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const doLogout = () => {
    logout();
    navigate("/login");
  };

  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [moreOpen]);

  const isAdmin = user?.role === "admin";
  const desktopNav = [
    { to: "/", label: tr("navDashboard", lang), icon: LayoutDashboard, end: true, show: true },
    { to: "/entry", label: tr("navNewEntry", lang), icon: PlusCircle, end: false, show: hasPermission("survey_entry") || hasPermission("fpo_consultation") },
    { to: "/farmers", label: tr("navFarmerRecords", lang), icon: Users, end: false, show: hasPermission("farmer_records") },
    { to: "/plots", label: tr("navPlotsMap", lang), icon: Map, end: false, show: hasPermission("plots_map") },
    { to: "/masters", label: tr("navMasterData", lang), icon: ClipboardList, end: false, show: isAdmin },
    { to: "/users", label: tr("navUsers", lang), icon: ShieldCheck, end: false, show: isAdmin },
  ].filter((item) => item.show);

  // The bottom tab bar only has room for a handful of icons, so it keeps the
  // 3 items a field user touches constantly; anything else a mobile user is
  // still entitled to (Plots Map, Master Data, Users — previously only ever
  // rendered in the desktop top nav, so an admin or plots_map-only user had
  // no way to reach them on a phone at all) goes in the "More" menu instead.
  const mobilePrimary = [
    { to: "/", label: tr("navDashboard", lang), icon: LayoutDashboard, end: true, show: true },
    { to: "/entry", label: tr("navNewEntry", lang), icon: PlusCircle, end: false, show: hasPermission("survey_entry") || hasPermission("fpo_consultation") },
    { to: "/farmers", label: tr("navFarmers", lang), icon: Users, end: false, show: hasPermission("farmer_records") },
  ].filter((item) => item.show);

  const mobileMore = [
    { to: "/plots", label: tr("navPlotsMap", lang), icon: Map, show: hasPermission("plots_map") },
    { to: "/masters", label: tr("navMasterData", lang), icon: ClipboardList, show: isAdmin },
    { to: "/users", label: tr("navUsers", lang), icon: ShieldCheck, show: isAdmin },
  ].filter((item) => item.show);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="sticky top-0 z-20">
        <header className="gt-gradient text-white shadow-md">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center font-bold text-lg shrink-0">GT</div>
              <div className="min-w-0">
                <div className="font-semibold text-[15px] leading-tight truncate">{tr("appTitle", lang)}</div>
                <div className="text-[11px] text-white/75 leading-tight truncate">{tr("appSubtitle", lang)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <SyncStatus />
              <button
                type="button"
                onClick={toggle}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 transition-colors rounded-full px-3 py-1.5 text-xs font-semibold"
                title="Switch language / ಭಾಷೆ ಬದಲಿಸಿ"
              >
                <Languages size={14} /> {lang === "en" ? "ಕನ್ನಡ" : "English"}
              </button>
              {user && (
                <div className="flex items-center gap-1.5 bg-white/15 rounded-full pl-2.5 pr-1 py-1 text-xs font-medium">
                  <UserCircle size={14} /> <span className="hidden sm:inline">{user.full_name}</span>
                  <button type="button" onClick={doLogout} title="Log out" className="bg-white/20 hover:bg-white/30 rounded-full p-1 ml-1">
                    <LogOut size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <nav className="hidden md:flex max-w-5xl mx-auto w-full px-4 gap-2 py-2.5 bg-white border-b border-[var(--gt-border)] shadow-sm">
          {desktopNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${
                  isActive
                    ? "bg-[var(--gt-purple)] text-white border-[var(--gt-purple)]"
                    : "bg-white text-[var(--gt-text-muted)] border-[var(--gt-border)]"
                }`
              }
            >
              <Icon size={15} /> {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="flex-1 max-w-5xl w-full mx-auto px-3 py-4 pb-24 md:pb-6">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--gt-border)] flex md:hidden z-20" ref={moreRef}>
        {mobilePrimary.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMoreOpen(false)}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? "text-[var(--gt-purple)]" : "text-[var(--gt-text-muted)]"
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
        {mobileMore.length > 0 && (
          <div className="flex-1 relative">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className={`w-full flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                moreOpen ? "text-[var(--gt-purple)]" : "text-[var(--gt-text-muted)]"
              }`}
            >
              <MoreHorizontal size={20} />
              More
            </button>
            {moreOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-white border border-[var(--gt-border)] rounded-xl shadow-lg overflow-hidden min-w-[180px]">
                {mobileMore.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b border-[var(--gt-border)] last:border-none ${
                        isActive ? "text-[var(--gt-purple)] bg-[#F1EBF7]" : "text-[var(--gt-text-muted)]"
                      }`
                    }
                  >
                    <Icon size={16} /> {label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  onClick={doLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--gt-danger)]"
                >
                  <LogOut size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
