"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CONTEST_STATUS_LABELS, daysUntil } from "@/lib/constants";
import { MonthCalendar } from "@/components/MonthCalendar";
import { GanttView } from "@/components/GanttView";

type Project = { id: number; name: string; status: string };
type Deliverable = { id: number; contestId: number; name: string; done: boolean; doneAt: string | null };
type Contest = {
  id: number; name: string; organizer: string; track: string; startDate: string;
  deadline: string; status: string; submitLink: string; notes: string; updatedAt: string;
  deliverables: Deliverable[];
  links: { id: number; project: { id: number; name: string; status: string; path: string } }[];
};
type Connection = { id: number; toolName: string; launchCommand: string; lastUsedAt: string | null };
type EventRow = { id: number; ts: string; entityType: string; entityId: number; action: string; afterJson: string };
type Scene = { id: number; name: string; items: { id: number; kind: string; refId: number }[] };

const STATUS_LABELS: Record<string, string> = {
  incubating: "孵化中", dev: "开发中", submitted: "已提交", maintain: "维护中", done: "完结",
};

const STATUS_ICONS: Record<string, string> = {
  incubating: "M12 3c-3.5 0-6 4-6 8a6 6 0 0 0 12 0c0-4-2.5-8-6-8Z",
  dev: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z",
  submitted: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  maintain: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z",
  done: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
};

const FOLDER_ICON = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z";

const ET_LABEL: Record<string, string> = {
  project: "项目", contest: "比赛", deliverable: "交付物", connection: "工具卡",
  connection_account: "账号", contest_project: "关联", sop_template: "SOP模板", backup: "备份",
  launch_scene: "启动场景",
};
const ACT_LABEL: Record<string, string> = {
  create: "创建", update: "更新", delete: "删除", launch: "启动",
  apply_sop: "套用 SOP", credential_open: "定位凭据", import_jubao: "聚宝盆导入",
  fire: "一键启动",
};

function Icon({ d, size = "h-5 w-5" }: { d: string; size?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={size}>
      <path d={d} />
    </svg>
  );
}

function Kpi({ label, value, icon, brand = false }: { label: string; value: number; icon: string; brand?: boolean }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${brand ? "bg-brand-soft text-brand" : "bg-slate-100 text-slate-500"}`}>
          <Icon d={icon} />
        </span>
        <div className="min-w-0">
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="mt-1 truncate text-xs text-slate-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

function eventText(e: EventRow) {
  const name = (() => { try { const j = JSON.parse(e.afterJson || "{}"); return j.name ?? j.label ?? j.sopName ?? j.toolName ?? ""; } catch { return ""; } })();
  const act = ACT_LABEL[e.action] ?? e.action;
  const et = ET_LABEL[e.entityType] ?? e.entityType;
  return name ? `${et}「${name}」${act}` : `${et} ${act}`;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [contests, setContests] = useState<Contest[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [latestBackup, setLatestBackup] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [matchView, setMatchView] = useState<"list" | "gantt">("list");
  const [busyConn, setBusyConn] = useState<number | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [busyScene, setBusyScene] = useState<number | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    fetch("/api/contests").then((r) => r.json()).then(setContests);
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
    fetch("/api/connections").then((r) => r.json()).then(setConnections);
    fetch("/api/events").then((r) => r.json()).then(setEvents);
    fetch("/api/scenes").then((r) => r.json()).then(setScenes);
    fetch("/api/backup").then((r) => r.json()).then((b) => {
      const auto = Array.isArray(b) ? b.filter((x: { dirName: string }) => x.dirName.startsWith("auto-")) : [];
      setLatestBackup(auto[0]?.dirName?.replace("auto-", "") ?? "");
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function launchConn(c: Connection) {
    setBusyConn(c.id);
    await fetch(`/api/connections/${c.id}/launch`, { method: "POST" });
    setBusyConn(null);
    load();
  }

  async function fireScene(s: Scene) {
    setBusyScene(s.id);
    const res = await fetch(`/api/scenes/${s.id}/fire`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "启动失败" }));
      window.alert(j.error ?? "启动失败");
    }
    setBusyScene(null);
    load();
  }

  const connName = (id: number) => connections.find((c) => c.id === id)?.toolName ?? `#${id}`;
  const sceneMembers = (s: Scene) =>
    s.items.map((it) => (it.kind === "connection" ? connName(it.refId) : "指定账号")).join(" + ");

  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const allMatches = [...contests].sort((a, b) => {
    const da = daysUntil(a.deadline), db = daysUntil(b.deadline);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
  const nearCount = allMatches.filter((c) => {
    const d = daysUntil(c.deadline);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  const topPrograms = [...connections]
    .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""))
    .slice(0, 6);
  const recentEvents = events.slice(0, 8);

  const greeting = !now ? "" : now.getHours() < 6 ? "夜深了" : now.getHours() < 12 ? "早上好" : now.getHours() < 18 ? "下午好" : "晚上好";
  const clock = now ? now.toLocaleTimeString("zh-CN", { hour12: false }) : "--:--:--";
  const dateText = now ? now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }) : "";

  return (
    <div className="space-y-6">
      {/* Hero：问候 + 实时时钟 */}
      <div className="flex flex-col gap-4 rounded-xl bg-sidebar p-6 text-sidebar-fg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-2xl font-semibold">{greeting}{greeting ? "，" : ""}这里是杨杨的AI比赛专用工作台</div>
          <p className="mt-1 text-sm text-sidebar-fg/70">连接本地内容与各种程序之间的桥梁</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-brand px-2.5 py-1 text-white">临近比赛 {nearCount} 场（7 天内）</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">自动备份每日 21:00{latestBackup ? ` · 最新 ${latestBackup}` : ""}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">晨报每日 8:30</span>
          </div>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <div className="font-mono text-4xl font-semibold tracking-wider">{clock}</div>
          <div className="mt-1 text-sm text-sidebar-fg/70">{dateText}</div>
          <button onClick={() => window.dispatchEvent(new Event("open-assistant"))}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
            🤖 问问 AI 助手
          </button>
        </div>
      </div>

      {/* 我的启动场景：一键并行拉起常用组合 */}
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">🚀 我的启动场景（{scenes.length}）</span>
          <Link href="/connections" className="text-xs text-blue-600 hover:underline">管理 / 新建 →</Link>
        </div>
        {scenes.length === 0 ? (
          <p className="text-sm text-slate-400">
            还没有场景。去「连接中心」把经常一起开的程序（含指定账号）存成组合，这里就能一键全部拉起。
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {scenes.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border bg-slate-50 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500" title={sceneMembers(s)}>
                    {sceneMembers(s) || "（空场景）"}
                  </div>
                </div>
                <button onClick={() => fireScene(s)} disabled={busyScene === s.id}
                  className="shrink-0 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                  {busyScene === s.id ? "拉起…" : "▶ 全部"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="已登记项目" value={projects.length} icon={FOLDER_ICON} brand />
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <Kpi key={k} label={label} value={byStatus[k] ?? 0} icon={STATUS_ICONS[k]} />
        ))}
      </div>

      {/* 赛事总览：全部比赛，可切甘特 */}
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">赛事总览（{contests.length} 场）</span>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              <button onClick={() => setMatchView("list")}
                className={`rounded-md px-2.5 py-1 text-xs ${matchView === "list" ? "bg-brand text-white" : "text-slate-600"}`}>列表</button>
              <button onClick={() => setMatchView("gantt")}
                className={`rounded-md px-2.5 py-1 text-xs ${matchView === "gantt" ? "bg-brand text-white" : "text-slate-600"}`}>甘特</button>
            </div>
            <Link href="/contests" className="text-xs text-blue-600 hover:underline">管理 →</Link>
          </div>
        </div>
        {matchView === "gantt" ? (
          <GanttView contests={contests} />
        ) : (
          <ul className="divide-y">
            {allMatches.map((c) => {
              const done = c.deliverables.filter((d) => d.done).length;
              const days = daysUntil(c.deadline);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {CONTEST_STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
                    {c.deliverables.length > 0 && <span>交付 {done}/{c.deliverables.length}</span>}
                    <span className={`font-semibold ${days !== null && days < 0 ? "text-slate-400" : days !== null && days <= 7 ? "text-red-600" : "text-blue-600"}`}>
                      {days === null ? "待定" : days < 0 ? `过期${-days}天` : `剩 ${days} 天`}
                    </span>
                    <span>{c.deadline || "—"}</span>
                  </div>
                </li>
              );
            })}
            {allMatches.length === 0 && <li className="py-4 text-sm text-slate-400">暂无比赛</li>}
          </ul>
        )}
      </div>

      {/* 三栏：月历 / 常用程序 / 最近动态 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 text-sm font-medium text-slate-600">日历</div>
          <MonthCalendar contests={contests} onPickDay={() => {}} />
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">常用程序 Top6</span>
            <Link href="/connections" className="text-xs text-blue-600 hover:underline">全部 →</Link>
          </div>
          <ul className="space-y-1.5">
            {topPrograms.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-sm">
                <span className="w-4 shrink-0 text-center text-xs font-semibold text-slate-300">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{c.toolName}</span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "未用"}
                </span>
                {c.launchCommand && (
                  <button onClick={() => launchConn(c)} disabled={busyConn === c.id}
                    title="一键调起"
                    className="shrink-0 rounded bg-brand px-1.5 py-0.5 text-[10px] text-white hover:opacity-90 disabled:opacity-50">▶</button>
                )}
              </li>
            ))}
            {topPrograms.length === 0 && <li className="py-4 text-sm text-slate-400">暂无工具卡</li>}
          </ul>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">最近动态</span>
            <Link href="/log" className="text-xs text-blue-600 hover:underline">全部 →</Link>
          </div>
          <ul className="space-y-2">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"></span>
                <span className="min-w-0 flex-1 truncate text-slate-600">{eventText(e)}</span>
                <span className="shrink-0 text-slate-300">
                  {new Date(e.ts).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}
                </span>
              </li>
            ))}
            {recentEvents.length === 0 && <li className="py-4 text-sm text-slate-400">暂无动态</li>}
          </ul>
        </div>
      </div>

      {/* 项目进展 */}
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">项目进展（最近更新）</span>
          <Link href="/projects" className="text-xs text-blue-600 hover:underline">全部 →</Link>
        </div>
        <ul className="divide-y">
          {projects.slice(0, 5).map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="truncate font-medium">{p.name}</span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{STATUS_LABELS[p.status] ?? p.status}</span>
            </li>
          ))}
          {projects.length === 0 && (
            <li className="py-4 text-sm text-slate-400">暂无数据，去「项目中枢」注册第一个项目</li>
          )}
        </ul>
      </div>
    </div>
  );
}
