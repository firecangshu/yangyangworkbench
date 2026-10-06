"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CONTEST_STATUS_LABELS,
  CONTEST_STATUS_ORDER,
  daysUntil,
} from "@/lib/constants";
import { activeNudges, nudgesForPhase, phaseOf } from "@/lib/contest-playbook";
import { MonthCalendar } from "@/components/MonthCalendar";
import { GanttView } from "@/components/GanttView";

type ProjectBrief = { id: number; name: string; status: string; path: string };
type Deliverable = { id: number; contestId: number; name: string; done: boolean; doneAt: string | null };
type SopStep = { id: number; name: string; sortOrder: number };
type SopTemplate = { id: number; name: string; description: string; steps: SopStep[] };
type Contest = {
  id: number;
  name: string;
  organizer: string;
  track: string;
  startDate: string;
  deadline: string;
  resultDate: string;
  status: string;
  submitLink: string;
  notes: string;
  updatedAt: string;
  deliverables: Deliverable[];
  links: { id: number; project: ProjectBrief }[];
};

const emptyForm = {
  name: "",
  organizer: "",
  track: "",
  startDate: "",
  deadline: "",
  resultDate: "",
  status: "research",
  submitLink: "",
  notes: "",
};

function progress(c: Contest) {
  const total = c.deliverables.length;
  const done = c.deliverables.filter((d) => d.done).length;
  return { done, total };
}

export default function ContestsPage() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [projects, setProjects] = useState<ProjectBrief[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newDeliv, setNewDeliv] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "calendar" | "gantt">("list");
  const [sops, setSops] = useState<SopTemplate[]>([]);
  const [showSopLib, setShowSopLib] = useState(false);
  const [sopForm, setSopForm] = useState({ name: "", description: "", steps: "" });
  const [sopPick, setSopPick] = useState("");

  const load = useCallback(() => {
    fetch("/api/contests").then((r) => r.json()).then(setContests);
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
    fetch("/api/sops").then((r) => r.json()).then(setSops);
  }, []);
  useEffect(() => { load(); }, [load]);

  // M32：助手确认融入后即时重取比赛/材料/SOP，本页与首页/日历有机回显
  useEffect(() => {
    const h = () => load();
    window.addEventListener("workbench-contests-changed", h);
    return () => window.removeEventListener("workbench-contests-changed", h);
  }, [load]);

  async function createSop() {
    if (!sopForm.name.trim()) { setError("模板名称是必填项"); return; }
    const res = await fetch("/api/sops", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sopForm),
    });
    if (!res.ok) { setError((await res.json()).error ?? "创建失败"); return; }
    setSopForm({ name: "", description: "", steps: "" });
    load();
  }

  async function removeSop(id: number, name: string) {
    if (!window.confirm(`确认删除模板「${name}」？（不影响已生成的交付物）`)) return;
    await fetch(`/api/sops/${id}`, { method: "DELETE" });
    load();
  }

  async function applySop(contestId: number) {
    if (!sopPick) return;
    const res = await fetch(`/api/contests/${contestId}/apply-sop`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sopId: Number(sopPick) }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "套用失败"); return; }
    const j = await res.json();
    window.alert(`已从「${j.sopName}」生成 ${j.created.length} 项交付物${j.skipped ? `（跳过 ${j.skipped} 项重复）` : ""}`);
    setSopPick("");
    load();
  }

  async function createContest() {
    setError("");
    if (!form.name.trim()) { setError("比赛名称是必填项"); return; }
    const res = await fetch("/api/contests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) { setError((await res.json()).error ?? "创建失败"); return; }
    setForm(emptyForm); setShowForm(false); load();
  }

  async function updateStatus(id: number, status: string) {
    setBusy(id);
    await fetch(`/api/contests/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    setBusy(null); load();
  }

  async function removeContest(id: number, name: string) {
    if (!window.confirm(`确认删除「${name}」的登记？（不删磁盘材料）`)) return;
    setBusy(id);
    await fetch(`/api/contests/${id}`, { method: "DELETE" });
    setBusy(null); load();
  }

  async function addDeliverable(contestId: number) {
    const name = newDeliv.trim();
    if (!name) return;
    await fetch(`/api/contests/${contestId}/deliverables`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    setNewDeliv(""); load();
  }

  async function toggleDeliverable(d: Deliverable) {
    await fetch(`/api/deliverables/${d.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: !d.done }),
    });
    load();
  }

  async function removeDeliverable(d: Deliverable) {
    await fetch(`/api/deliverables/${d.id}`, { method: "DELETE" });
    load();
  }

  async function linkProject(contestId: number, projectId: number) {
    if (!projectId) return;
    await fetch(`/api/contests/${contestId}/link`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
    });
    load();
  }

  async function unlinkProject(contestId: number, projectId: number) {
    await fetch(`/api/contests/${contestId}/link`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }),
    });
    load();
  }

  const sorted = [...contests].sort((a, b) => {
    const da = daysUntil(a.deadline);
    const db = daysUntil(b.deadline);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
  const shown = filter === "all" ? sorted : sorted.filter((c) => c.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">比赛追踪</h1>
          <p className="mt-1 text-sm text-slate-500">
            共 {contests.length} 场 · 按截止日倒计时排序 · 操作全部记入流水
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <button
              onClick={() => setView("list")}
              className={`rounded-md px-3 py-1.5 text-xs ${view === "list" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              列表
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`rounded-md px-3 py-1.5 text-xs ${view === "calendar" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              日历
            </button>
            <button
              onClick={() => setView("gantt")}
              className={`rounded-md px-3 py-1.5 text-xs ${view === "gantt" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              甘特
            </button>
          </div>
          <button
            onClick={() => setShowSopLib((s) => !s)}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            流程模板库 {sops.length}
          </button>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {showForm ? "收起表单" : "+ 登记比赛"}
          </button>
        </div>
      </div>

      {showSopLib && (
        <div className="card-fluid rounded-xl border bg-white p-4">
          <div className="mb-1 font-medium">SOP 流程模板库</div>
          <p className="mb-3 text-xs text-slate-500">把可复用的流程定义一次（如「比赛投稿 SOP」），在比赛详情里一键套用生成检查清单。</p>
          <div className="space-y-2">
            {sops.map((s) => (
              <div key={s.id} className="rounded-lg border bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{s.name}</div>
                  <button onClick={() => removeSop(s.id, s.name)} className="text-xs text-slate-300 hover:text-red-500">删</button>
                </div>
                {s.description && <div className="mt-0.5 text-xs text-slate-500">{s.description}</div>}
                <div className="mt-1 text-xs text-slate-400">{s.steps.length} 步：{s.steps.map((x) => x.name).join(" → ")}</div>
              </div>
            ))}
            {sops.length === 0 && <div className="text-xs text-slate-400">还没有模板，在下面创建第一个。</div>}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="模板名称 *"
              value={sopForm.name} onChange={(e) => setSopForm({ ...sopForm, name: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="一句话说明"
              value={sopForm.description} onChange={(e) => setSopForm({ ...sopForm, description: e.target.value })} />
            <textarea className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" rows={4}
              placeholder="流程步骤，每行一步（如：&#10;报名注册&#10;开发与打磨&#10;材料准备&#10;提交&#10;复盘）"
              value={sopForm.steps} onChange={(e) => setSopForm({ ...sopForm, steps: e.target.value })} />
          </div>
          <button onClick={createSop} className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">保存模板</button>
        </div>
      )}

      {showForm && (
        <div className="card-fluid rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="比赛名称 *"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="主办方"
              value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="赛道"
              value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="开始日 yyyy-MM-dd（可空，用于甘特图）"
              value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="截止日 yyyy-MM-dd（可空）"
              value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="结果公布日 yyyy-MM-dd（可空，用于甘特/日历里程碑）"
              value={form.resultDate} onChange={(e) => setForm({ ...form, resultDate: e.target.value })} />
            <select className="rounded-lg border px-3 py-2 text-sm"
              value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {CONTEST_STATUS_ORDER.map((k) => (
                <option key={k} value={k}>{CONTEST_STATUS_LABELS[k]}</option>
              ))}
            </select>
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="提交链接"
              value={form.submitLink} onChange={(e) => setForm({ ...form, submitLink: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="备注"
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          <button onClick={createContest}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">
            保存
          </button>
        </div>
      )}

      {view === "gantt" && <GanttView contests={contests} />}

      {view === "calendar" && (
        <MonthCalendar
          contests={contests}
          onOpenContest={(id) => {
            setExpanded(id);
            setView("list");
          }}
        />
      )}

      {view === "list" && (
        <>
      <div className="flex flex-wrap gap-1.5">
        {[{ k: "all", v: "全部" }, ...CONTEST_STATUS_ORDER.map((s) => ({ k: s, v: CONTEST_STATUS_LABELS[s] }))].map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`rounded-full px-3 py-1 text-xs ${filter === f.k ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}>
            {f.v}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((c) => {
          const days = daysUntil(c.deadline);
          const { done, total } = progress(c);
          const remain = activeNudges(nudgesForPhase(phaseOf(c.status)), c.deliverables).length;
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="card-fluid rounded-xl border bg-white">
              <div className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/contests/${c.id}`} className="font-medium hover:text-brand hover:underline">{c.name}</Link>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {CONTEST_STATUS_LABELS[c.status] ?? c.status}
                    </span>
                    {remain > 0 && phaseOf(c.status) !== "closed" && (
                      <Link href={`/contests/${c.id}`} className="rounded bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand hover:opacity-80">
                        还差 {remain} 项
                      </Link>
                    )}
                    {c.track && <span className="text-xs text-slate-400">{c.track}</span>}
                    {c.organizer && <span className="text-xs text-slate-400">· {c.organizer}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>
                      截止：{c.deadline || "待定"}
                      {days !== null && (
                        <span className={days < 0 ? "ml-1 text-slate-400" : days <= 7 ? "ml-1 font-semibold text-red-600" : "ml-1 text-blue-600"}>
                          {days < 0 ? `已过期 ${-days} 天` : `剩 ${days} 天`}
                        </span>
                      )}
                    </span>
                    {total > 0 && <span>交付 {done}/{total}</span>}
                    {c.links.length > 0 && (
                      <span>关联：{c.links.map((l) => l.project.name).join("、")}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select disabled={busy === c.id} value={c.status}
                    onChange={(e) => updateStatus(c.id, e.target.value)}
                    className="rounded-md border bg-white px-2 py-1 text-xs">
                    {CONTEST_STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{CONTEST_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                  <button onClick={() => setExpanded(isOpen ? null : c.id)}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50">
                    {isOpen ? "收起" : "详情"}
                  </button>
                  <button onClick={() => removeContest(c.id, c.name)}
                    className="rounded-md border px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    删除
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="grid gap-6 border-t bg-slate-50/60 p-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-600">交付物清单</div>
                    <ul className="space-y-1.5">
                      {c.deliverables.map((d) => (
                        <li key={d.id} className="flex items-center justify-between rounded-md bg-white px-2 py-1.5 text-sm">
                          <label className="flex cursor-pointer items-center gap-2">
                            <input type="checkbox" checked={d.done} onChange={() => toggleDeliverable(d)} />
                            <span className={d.done ? "text-slate-400 line-through" : ""}>{d.name}</span>
                          </label>
                          <button onClick={() => removeDeliverable(d)} className="text-xs text-red-400 hover:text-red-600">删</button>
                        </li>
                      ))}
                      {c.deliverables.length === 0 && (
                        <li className="text-xs text-slate-400">暂无交付物，添加第一项：</li>
                      )}
                    </ul>
                    <div className="mt-2 flex gap-2">
                      <input className="flex-1 rounded-md border px-2 py-1 text-xs" placeholder="交付物名称"
                        value={newDeliv} onChange={(e) => setNewDeliv(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addDeliverable(c.id)} />
                      <button onClick={() => addDeliverable(c.id)}
                        className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white">添加</button>
                    </div>
                    {sops.length > 0 && (
                      <div className="mt-2 flex gap-2">
                        <select className="flex-1 rounded-md border bg-white px-2 py-1 text-xs"
                          value={sopPick} onChange={(e) => setSopPick(e.target.value)}>
                          <option value="">从流程模板生成…</option>
                          {sops.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}（{s.steps.length} 步）</option>
                          ))}
                        </select>
                        <button onClick={() => applySop(c.id)} disabled={!sopPick}
                          className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-40">套用</button>
                      </div>
                    )}
                    {c.submitLink && (
                      <a href={c.submitLink} target="_blank" rel="noreferrer"
                        className="mt-3 inline-block text-xs text-blue-600 hover:underline">
                        提交链接 ↗
                      </a>
                    )}
                    {c.notes && <p className="mt-2 text-xs text-slate-500">{c.notes}</p>}
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium text-slate-600">关联项目</div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.links.map((l) => (
                        <span key={l.id}
                          className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs">
                          {l.project.name}
                          <button onClick={() => unlinkProject(c.id, l.project.id)}
                            className="text-slate-400 hover:text-red-600" title="解除关联">×</button>
                        </span>
                      ))}
                      {c.links.length === 0 && <span className="text-xs text-slate-400">暂无关联</span>}
                    </div>
                    <select className="mt-3 w-full rounded-md border bg-white px-2 py-1.5 text-xs"
                      value=""
                      onChange={(e) => linkProject(c.id, Number(e.target.value))}>
                      <option value="">+ 关联一个项目…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="card-fluid rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-400">
            没有符合条件的比赛
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
