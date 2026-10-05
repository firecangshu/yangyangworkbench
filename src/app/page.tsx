"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONTEST_STATUS_LABELS, daysUntil } from "@/lib/constants";

type Project = { id: number; name: string; status: string };
type ContestBrief = {
  id: number; name: string; deadline: string; status: string;
  deliverables: { done: boolean }[];
};

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

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [contests, setContests] = useState<ContestBrief[]>([]);

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then(setProjects);
    fetch("/api/contests").then((r) => r.json()).then(setContests);
  }, []);

  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const upcoming = [...contests]
    .filter((c) => !["won", "lost", "cancelled"].includes(c.status))
    .map((c) => ({ ...c, days: daysUntil(c.deadline) }))
    .sort((a, b) => {
      if (a.days === null && b.days === null) return 0;
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    })
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">仪表盘</h1>
        <p className="mt-1 text-sm text-slate-500">tagex M14 · 本地优先 · 数据存于本机 SQLite</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="已登记项目" value={projects.length} icon={FOLDER_ICON} brand />
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <Kpi key={k} label={label} value={byStatus[k] ?? 0} icon={STATUS_ICONS[k]} />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">比赛倒计时 TOP3</span>
            <Link href="/contests" className="text-xs text-blue-600 hover:underline">全部 →</Link>
          </div>
          <ul className="divide-y">
            {upcoming.map((c) => {
              const done = c.deliverables.filter((d) => d.done).length;
              return (
                <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {CONTEST_STATUS_LABELS[c.status] ?? c.status}
                      {c.deliverables.length > 0 && ` · 交付 ${done}/${c.deliverables.length}`}
                    </div>
                  </div>
                  <div className="shrink-0 pl-3 text-right">
                    <div className={`text-sm font-semibold ${c.days !== null && c.days <= 7 ? "text-red-600" : "text-blue-600"}`}>
                      {c.days === null ? "待定" : c.days < 0 ? `过期${-c.days}天` : `${c.days} 天`}
                    </div>
                    <div className="text-xs text-slate-400">{c.deadline || "—"}</div>
                  </div>
                </li>
              );
            })}
            {upcoming.length === 0 && (
              <li className="py-4 text-sm text-slate-400">暂无进行中的比赛</li>
            )}
          </ul>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">最近更新的项目</span>
            <Link href="/projects" className="text-xs text-blue-600 hover:underline">全部 →</Link>
          </div>
          <ul className="divide-y">
            {projects.slice(0, 5).map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 pl-2 text-xs text-slate-400">{STATUS_LABELS[p.status] ?? p.status}</span>
              </li>
            ))}
            {projects.length === 0 && (
              <li className="py-4 text-sm text-slate-400">暂无数据，去「项目中枢」注册第一个项目</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
