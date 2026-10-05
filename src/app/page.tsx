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
        <p className="mt-1 text-sm text-slate-500">雀台 M2 · 本地优先 · 数据存于本机 SQLite</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-slate-500">已登记项目</div>
          <div className="mt-1 text-3xl font-semibold">{projects.length}</div>
        </div>
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <div key={k} className="rounded-xl border bg-white p-4">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-3xl font-semibold">{byStatus[k] ?? 0}</div>
          </div>
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
