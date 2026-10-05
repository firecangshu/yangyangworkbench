"use client";

import { useEffect, useMemo, useState } from "react";
import { dayMark } from "@/lib/cn-calendar";

type ContestBrief = {
  id: number;
  name: string;
  deadline: string;
  status: string;
  deliverables: { done: boolean }[];
};

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

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-medium">{monthLabel}</div>
        <div className="flex gap-2">
          <button
            className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            ← 上月
          </button>
          <button
            className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
            onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          >
            回今天
          </button>
          <button
            className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            下月 →
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400">
        {WEEK.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="min-h-[74px] rounded bg-slate-50/50" />;
          const key = ymd(d);
          const items = byDay.get(key) ?? [];
          const isToday = key === todayStr;
          const mark = dayMark(d.getFullYear(), d.getMonth(), d.getDate());
          return (
            <button
              key={key}
              onClick={() => onPickDay?.(key, items)}
              className={`flex min-h-[74px] flex-col rounded border p-1 text-left align-top transition ${
                isToday ? "border-blue-500 bg-blue-50" : "border-slate-100 hover:border-slate-300"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-xs ${isToday ? "font-bold text-blue-700" : "text-slate-500"}`}>
                  {d.getDate()}
                </span>
                <span className="text-[9px] leading-none text-slate-300">{mark.lunarDay}</span>
              </div>
              {mark.festivals.length > 0 && (
                <div className="mt-0.5 truncate text-[10px] font-medium leading-tight text-amber-600" title={mark.festivals.join("・")}>
                  {mark.festivals[0]}
                </div>
              )}
              {mark.jieqi && (
                <div className="truncate text-[10px] leading-tight text-teal-600">{mark.jieqi}</div>
              )}
              {items.map((c) => (
                <div
                  key={c.id}
                  className="mt-0.5 truncate rounded bg-brand-soft px-1 text-[10px] leading-tight text-brand"
                  title={`${c.name}（截止）`}
                >
                  ◈ {c.name}
                </div>
              ))}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
        <span><span className="text-amber-600">■</span> 节日</span>
        <span><span className="text-teal-600">■</span> 节气</span>
        <span><span className="text-brand">◈</span> 赛事截止</span>
      </div>
      {noDeadline.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
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
