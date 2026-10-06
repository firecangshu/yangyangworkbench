"use client";

import { useEffect, useMemo, useState } from "react";
import { dayMark, lunarYearLabel } from "@/lib/cn-calendar";
import { deriveMilestones, type Milestone, type MilestoneType } from "@/lib/contest-playbook";

type ContestBrief = {
  id: number;
  name: string;
  startDate: string;
  deadline: string;
  resultDate: string;
  status: string;
  deliverables: { done: boolean }[];
};

// 里程碑圆点颜色：启动=天蓝、截止=赤陶、结果按胜负（获奖=翠绿/未中=红/待定=紫）
const DOT_CLS: Record<MilestoneType, string> = {
  start: "bg-sky-500",
  deadline: "bg-brand",
  result: "bg-violet-500",
};
function dotCls(m: Milestone): string {
  if (m.type !== "result") return DOT_CLS[m.type];
  return m.status === "won" ? "bg-emerald-500" : m.status === "lost" ? "bg-red-400" : DOT_CLS.result;
}

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function MonthCalendar({
  contests,
  onPickDay,
}: {
  contests: ContestBrief[];
  onPickDay?: (day: string, items: ContestBrief[]) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const byDay = useMemo(() => {
    const map = new Map<string, ContestBrief[]>();
    for (const c of contests) {
      if (!c.deadline) continue;
      const arr = map.get(c.deadline) ?? [];
      arr.push(c);
      map.set(c.deadline, arr);
    }
    return map;
  }, [contests]);

  // 里程碑按日聚合（启动/截止/结果三类），供圆点渲染
  const msByDay = useMemo(() => {
    const map = new Map<string, Milestone[]>();
    for (const m of deriveMilestones(contests)) {
      const arr = map.get(m.date) ?? [];
      arr.push(m);
      map.set(m.date, arr);
    }
    return map;
  }, [contests]);

  const noDeadline = contests.filter((c) => !c.deadline);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // 周一为 0
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const list: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) list.push(null);
    for (let d = 1; d <= daysInMonth; d++) list.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [cursor]);

  const todayStr = ymd(today);
  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
  const yearLabel = lunarYearLabel(cursor.getFullYear(), cursor.getMonth(), 1);

  return (
    <div className="card-fluid rounded-xl bg-white p-3 shadow-[0_6px_20px_rgba(31,41,55,0.07)] ring-1 ring-slate-100">
      {/* 标题行：📅 图标 + 粗月份 + 干支年副标题（对齐社工星火区块规范）；导航收为幽灵图标钮 + 赤陶「回今天」
          M26：本卡根元素带 card-fluid，所以卡内字号不再写死 px，而是走全局 text-* 映射（由卡片宽度驱动）：
          月份标题 text-lg / 日期 text-base / 节日节气赛事 text-sm / 农历星期图例 text-xs —— 卡片变宽字同比变大 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-[17px]">📅</span>
          <div className="leading-tight">
            <div className="text-lg font-semibold">{monthLabel}</div>
            <div className="text-xs text-slate-400">{yearLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="上一月"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <button
            className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            回今天
          </button>
          <button
            aria-label="下一月"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
        {WEEK.map((w) => (
          <div key={w} className="py-0.5">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="min-h-[clamp(78px,9cqi,112px)] rounded-lg bg-slate-50/60" />;
          const key = ymd(d);
          const items = byDay.get(key) ?? [];
          const mss = (msByDay.get(key) ?? []).filter((m) => m.type !== "deadline");
          const isToday = key === todayStr;
          const mark = dayMark(d.getFullYear(), d.getMonth(), d.getDate());
          return (
            <button
              key={key}
              onClick={() => onPickDay?.(key, items)}
              className={`flex min-h-[clamp(78px,9cqi,112px)] flex-col rounded-lg p-1.5 text-left align-top transition ${
                isToday ? "bg-brand text-white shadow-[0_3px_8px_rgba(217,83,79,0.3)]" : "bg-slate-50/60 hover:bg-slate-100"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-base font-semibold tabular-nums ${isToday ? "text-white" : "text-slate-600"}`}>
                  {d.getDate()}
                </span>
                <span className={`text-xs leading-none ${isToday ? "text-white/80" : "text-slate-400"}`}>{mark.lunarDay}</span>
              </div>
              {mark.festivals.length > 0 && (
                <div className={`truncate text-sm font-medium leading-snug ${isToday ? "text-white" : "text-amber-600"}`} title={mark.festivals.join("・")}>
                  {mark.festivals[0]}
                </div>
              )}
              {mark.jieqi && (
                <div className={`truncate text-sm leading-snug ${isToday ? "text-white/90" : "text-teal-600"}`}>{mark.jieqi}</div>
              )}
              {items.map((c) => (
                <div
                  key={c.id}
                  className={`mt-0.5 truncate rounded px-1 text-sm leading-snug ${isToday ? "bg-white/20 text-white" : "bg-brand-soft text-brand"}`}
                  title={`${c.name}（截止）`}
                >
                  ◈ {c.name}
                </div>
              ))}
              {mss.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {mss.map((m, i) => (
                    <span
                      key={`${m.contestId}-${m.type}-${i}`}
                      title={`${m.contestName}（${m.type === "start" ? "启动" : "结果公布"}）`}
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotCls(m)} ${isToday ? "ring-1 ring-white/70" : ""}`}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span><span className="text-brand">■</span> 今天</span>
        <span><span className="text-amber-600">■</span> 节日</span>
        <span><span className="text-teal-600">■</span> 节气</span>
        <span><span className="text-brand">◈</span> 赛事截止</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" /> 启动</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" /> 结果公布</span>
      </div>
      {noDeadline.length > 0 && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2.5">
          <div className="text-xs font-medium text-slate-600">截止日待定（{noDeadline.length} 场）</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {noDeadline.map((c) => (
              <span key={c.id} className="rounded-full border bg-white px-2 py-0.5 text-xs text-slate-600">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
