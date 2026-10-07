"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";

type Project = {
  id: number;
  name: string;
  path: string;
  category: string;
  status: string;
  summary: string;
  tags: string;
  lastNote: string;
  updatedAt: string;
};

const emptyForm = {
  name: "",
  path: "",
  category: "skill",
  status: "incubating",
  summary: "",
  tags: "",
};

const STATUS_COLORS: Record<string, string> = {
  incubating: "bg-slate-100 text-slate-700",
  dev: "bg-blue-50 text-blue-700",
  submitted: "bg-emerald-50 text-emerald-700",
  maintain: "bg-amber-50 text-amber-700",
  done: "bg-slate-200 text-slate-500",
};

type SyncReport = {
  scannedAt: string;
  total: number;
  healthy: { id: number; name: string; path: string }[];
  missing: { id: number; name: string; path: string }[];
  newDirs: { name: string; path: string }[];
  summary: { healthyCount: number; missingCount: number; newCount: number };
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"table" | "board">("table");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createProject() {
    setError("");
    if (!form.name.trim() || !form.path.trim()) { setError("名称和路径是必填项"); return; }
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) { setError((await res.json()).error ?? "创建失败"); return; }
    setForm(emptyForm); setShowForm(false); load();
  }

  async function updateStatus(id: number, status: string) {
    setBusy(id);
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null); load();
  }

  async function removeProject(id: number, name: string) {
    if (!window.confirm(`确认删除「${name}」的登记？（只删台账，不删磁盘文件）`)) return;
    setBusy(id);
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setBusy(null); load();
  }

  async function openDir(id: number) {
    setBusy(id);
    const res = await fetch(`/api/projects/${id}/open`, { method: "POST" });
    const d = await res.json();
    if (!res.ok) window.alert(d.error ?? "打开失败");
    setBusy(null);
  }

  async function runSync() {
    setSyncing(true);
    setSyncReport(null);
    try {
      const res = await fetch("/api/projects/sync", { method: "POST" });
      if (res.ok) setSyncReport(await res.json());
    } finally {
      setSyncing(false);
    }
  }

  async function applySync() {
    if (!syncReport) return;
    const toRegister = syncReport.newDirs.map((d) => d.path);
    const toMarkDone = syncReport.missing.map((m) => m.id);
    if (toRegister.length === 0 && toMarkDone.length === 0) { setSyncReport(null); return; }
    const msg = `确认应用同步？\n` +
      (toRegister.length > 0 ? `· 登记 ${toRegister.length} 个新目录\n` : "") +
      (toMarkDone.length > 0 ? `· 标记 ${toMarkDone.length} 个丢失项目为已完结` : "");
    if (!window.confirm(msg)) return;
    await fetch("/api/projects/sync", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ register: toRegister, markDone: toMarkDone }),
    });
    setSyncReport(null);
    load();
  }

  const missingIds = new Set(syncReport?.missing.map((m) => m.id) ?? []);

  const shown = filter === "all" ? projects : projects.filter((p) => p.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">项目中枢</h1>
          <p className="mt-1 text-sm text-slate-500">
            共 {projects.length} 个项目 · 操作全部记入流水
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button
              onClick={() => setView("table")}
              className={`rounded-md px-3 py-1.5 text-xs ${view === "table" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              表格
            </button>
            <button
              onClick={() => setView("board")}
              className={`rounded-md px-3 py-1.5 text-xs ${view === "board" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              看板
            </button>
          </div>
          <button
            onClick={runSync}
            disabled={syncing}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? "扫描中…" : "刷新匹配"}
          </button>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showForm ? "收起表单" : "+ 注册项目"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card-fluid rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-lg border px-3 py-2 text-sm"
              placeholder="项目名称 *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm"
              placeholder="本地路径 * 例如 E:\27.鹅在——AI智能体居家守护系统"
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
            />
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {STATUS_ORDER.map((k) => (
                <option key={k} value={k}>{STATUS_LABELS[k]}</option>
              ))}
            </select>
            <input
              className="rounded-lg border px-3 py-2 text-sm sm:col-span-2"
              placeholder="标签（逗号分隔），如 居家安防,比赛"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
            <input
              className="rounded-lg border px-3 py-2 text-sm sm:col-span-2"
              placeholder="一句话说明"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </div>
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          <button
            onClick={createProject}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            保存
          </button>
        </div>
      )}

      {syncReport && (
        <div className="card-fluid rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">
              同步报告 · {new Date(syncReport.scannedAt).toLocaleTimeString("zh-CN", { hour12: false })}
            </div>
            <div className="flex gap-2">
              <button onClick={applySync} className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700">
                应用变更
              </button>
              <button onClick={() => setSyncReport(null)} className="rounded-md border px-3 py-1 text-xs hover:bg-slate-50">
                关闭
              </button>
            </div>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-lg bg-emerald-50 p-2">
              <span className="font-medium text-emerald-700">✓ 健康 {syncReport.summary.healthyCount}</span>
              <div className="mt-1 text-emerald-600">目录存在，台账正常</div>
            </div>
            <div className="rounded-lg bg-amber-50 p-2">
              <span className="font-medium text-amber-700">⚠ 丢失 {syncReport.summary.missingCount}</span>
              <div className="mt-1 text-amber-600">目录已不存在于磁盘</div>
              {syncReport.missing.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {syncReport.missing.slice(0, 5).map((m) => (
                    <li key={m.id} className="truncate text-amber-500" title={m.path}>{m.name}</li>
                  ))}
                  {syncReport.missing.length > 5 && <li className="text-amber-400">…等 {syncReport.missing.length} 个</li>}
                </ul>
              )}
            </div>
            <div className="rounded-lg bg-blue-50 p-2">
              <span className="font-medium text-blue-700">+ 新增 {syncReport.summary.newCount}</span>
              <div className="mt-1 text-blue-600">磁盘上有，台账未登记</div>
              {syncReport.newDirs.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {syncReport.newDirs.slice(0, 5).map((d) => (
                    <li key={d.path} className="truncate text-blue-500" title={d.path}>{d.name}</li>
                  ))}
                  {syncReport.newDirs.length > 5 && <li className="text-blue-400">…等 {syncReport.newDirs.length} 个</li>}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {view === "table" && (
        <>
          <div className="flex gap-1.5">
            {[{ k: "all", v: "全部" }, ...STATUS_ORDER.map((s) => ({ k: s, v: STATUS_LABELS[s] }))].map(
              (f) => (
                <button
                  key={f.k}
                  onClick={() => setFilter(f.k)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    filter === f.k ? "bg-slate-900 text-white" : "border bg-white text-slate-600"
                  }`}
                >
                  {f.v}
                </button>
              )
            )}
          </div>

          <div className="card-fluid overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">项目</th>
                  <th className="px-4 py-3 font-medium">类别</th>
                  <th className="px-4 py-3 font-medium">标签</th>
                  <th className="px-4 py-3 font-medium">更新时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((p) => (
                  <tr key={p.id} className={`hover:bg-slate-50/60 ${missingIds.has(p.id) ? "bg-amber-50/50" : ""}`}>
                    <td className="px-4 py-3">
                      <select
                        disabled={busy === p.id}
                        value={p.status}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        className="rounded-md border bg-white px-2 py-1 text-xs"
                      >
                        {STATUS_ORDER.map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {p.name}
                        {missingIds.has(p.id) && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">目录丢失</span>
                        )}
                      </div>
                      <div className="mt-0.5 max-w-md truncate text-xs text-slate-400" title={p.path}>
                        {p.path}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {CATEGORY_LABELS[p.category] ?? p.category}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{p.tags || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(p.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openDir(p.id)}
                          disabled={busy === p.id}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                        >
                          打开目录
                        </button>
                        <button
                          onClick={() => removeProject(p.id, p.name)}
                          disabled={busy === p.id}
                          className="rounded-md border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                      没有符合条件的项目
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "board" && (
        <div className="grid gap-3 lg:grid-cols-5">
          {STATUS_ORDER.map((s) => {
            const col = projects.filter((p) => p.status === s);
            return (
              <div key={s} className="min-h-40 rounded-xl bg-slate-100/70 p-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s]}`}>
                    {STATUS_LABELS[s]}
                  </span>
                  <span className="text-xs text-slate-400">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((p) => (
                    <div key={p.id} className="rounded-lg border bg-white p-2.5 shadow-sm">
                      <div className="text-sm font-medium leading-snug">{p.name}</div>
                      <div className="mt-0.5 truncate text-xs text-slate-400" title={p.path}>
                        {p.path}
                      </div>
                      {p.tags && <div className="mt-1 text-xs text-slate-400">{p.tags}</div>}
                      <div className="mt-2 flex items-center justify-between">
                        <select
                          disabled={busy === p.id}
                          value={p.status}
                          onChange={(e) => updateStatus(p.id, e.target.value)}
                          className="rounded border px-1 py-0.5 text-xs"
                        >
                          {STATUS_ORDER.map((k) => (
                            <option key={k} value={k}>{STATUS_LABELS[k]}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => openDir(p.id)}
                          disabled={busy === p.id}
                          className="rounded border px-1.5 py-0.5 text-xs hover:bg-slate-50"
                        >
                          打开
                        </button>
                      </div>
                    </div>
                  ))}
                  {col.length === 0 && (
                    <div className="rounded-lg border border-dashed px-2 py-4 text-center text-xs text-slate-400">
                      空
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
