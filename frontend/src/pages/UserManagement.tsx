import { useEffect, useState } from "react";
import { api } from "../api";
import { UserPlus, ShieldCheck, X } from "lucide-react";

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: "admin" | "field";
  permissions: string[];
  is_active: boolean;
  created_at: string;
  locked_until: string | null;
}

const MODULE_LABELS: Record<string, string> = {
  survey_entry: "New Survey Entry",
  farmer_records: "Farmer Records (view & edit)",
  plots_map: "Plots & Map",
  fpo_consultation: "FPO Consultation",
};

function emptyForm() {
  return { username: "", full_name: "", email: "", password: "", role: "field" as "admin" | "field", permissions: [] as string[] };
}

export default function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyForm());

  const hasAdmin = users.some((u) => u.role === "admin");

  const reload = () => {
    api.listUsers().then(setUsers).catch((e) => setError(e.message));
  };

  useEffect(() => {
    reload();
    api.permissionModules().then(setModules).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({ username: u.username, full_name: u.full_name, email: u.email || "", password: "", role: u.role, permissions: u.permissions });
    setError("");
    setShowForm(true);
  };

  const togglePermission = (m: string) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(m) ? f.permissions.filter((p) => p !== m) : [...f.permissions, m],
    }));
  };

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      if (editing) {
        await api.updateUser(editing.id, {
          full_name: form.full_name,
          email: form.email || null,
          role: form.role,
          permissions: form.role === "field" ? form.permissions : [],
          ...(form.password ? { new_password: form.password } : {}),
        });
      } else {
        await api.createUser({
          username: form.username,
          full_name: form.full_name,
          email: form.email || null,
          password: form.password,
          role: form.role,
          permissions: form.role === "field" ? form.permissions : [],
        });
      }
      setShowForm(false);
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    setError("");
    try {
      await api.updateUser(u.id, { is_active: !u.is_active });
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--gt-purple-dark)] flex items-center gap-2">
            <ShieldCheck size={20} /> User Management
          </h1>
          <p className="text-sm text-[var(--gt-text-muted)]">Create field-team and admin accounts, and control which modules each user can access.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 bg-[var(--gt-purple)] text-white px-3 py-2 rounded-lg text-sm font-semibold shrink-0"
        >
          <UserPlus size={16} /> New User
        </button>
      </div>

      {error && !showForm && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="gt-card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--gt-text-muted)] border-b border-[var(--gt-border)]">
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Modules</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--gt-border)] last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{u.full_name}</div>
                  <div className="text-xs text-[var(--gt-text-muted)]">@{u.username}{u.email ? ` · ${u.email}` : ""}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {u.role === "admin" ? "Admin" : "Field Team"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-[var(--gt-text-muted)]">
                  {u.role === "admin" ? "All modules" : u.permissions.map((p) => MODULE_LABELS[p] || p).join(", ") || "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {u.is_active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => openEdit(u)} className="text-xs font-medium text-[var(--gt-purple)] mr-3">Edit</button>
                  {u.role !== "admin" && (
                    <button type="button" onClick={() => toggleActive(u)} className="text-xs font-medium text-[var(--gt-text-muted)]">
                      {u.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-[var(--gt-purple-dark)]">{editing ? "Edit User" : "New User"}</h2>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}

            <div className="flex flex-col gap-3">
              {!editing && (
                <div>
                  <label className="text-xs font-medium text-[var(--gt-text-muted)]">Username</label>
                  <input className="gt-input w-full mt-1" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-[var(--gt-text-muted)]">Full Name</label>
                <input className="gt-input w-full mt-1" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--gt-text-muted)]">Email (optional)</label>
                <input className="gt-input w-full mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--gt-text-muted)]">{editing ? "New Password (leave blank to keep)" : "Password"}</label>
                <input type="password" className="gt-input w-full mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                {form.password && (
                  <p className="text-[11px] text-[var(--gt-text-muted)] mt-1">
                    Must be at least 10 characters, with at least one uppercase letter and one digit.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--gt-text-muted)]">Role</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, role: "field" })}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${form.role === "field" ? "bg-[var(--gt-purple)] text-white border-[var(--gt-purple)]" : "border-[var(--gt-border)]"}`}
                  >
                    Field Team
                  </button>
                  <button
                    type="button"
                    disabled={hasAdmin && (!editing || editing.role !== "admin")}
                    onClick={() => setForm({ ...form, role: "admin" })}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${form.role === "admin" ? "bg-[var(--gt-purple)] text-white border-[var(--gt-purple)]" : "border-[var(--gt-border)]"}`}
                  >
                    Admin
                  </button>
                </div>
                {hasAdmin && (!editing || editing.role !== "admin") && (
                  <p className="text-xs text-[var(--gt-text-muted)] mt-1">An admin account already exists — only one admin is permitted.</p>
                )}
              </div>

              {form.role === "field" && (
                <div>
                  <label className="text-xs font-medium text-[var(--gt-text-muted)]">Module Access</label>
                  <div className="flex flex-col gap-1.5 mt-1">
                    {modules.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.permissions.includes(m)} onChange={() => togglePermission(m)} />
                        {MODULE_LABELS[m] || m}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="bg-[var(--gt-purple)] text-white rounded-lg py-2.5 font-semibold text-sm mt-2 disabled:opacity-60"
              >
                {busy ? "Saving…" : editing ? "Save Changes" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
