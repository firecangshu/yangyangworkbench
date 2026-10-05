"use client";

import { useMemo } from "react";
import { CONTEST_STATUS_LABELS, daysUntil } from "@/lib/constants";

type Contest = {
  id: number;
  name: string;
  startDate: string;
  deadline: string;
  status: string;
};

const BAR_COLORS: Record<string, string> = {
  research: "bg-slate-400",
  registered: "bg-blue-500",
  preparing: "bg-amber-500",
  submitted: "bg-emerald-500",
  won: "bg-emerald-700",
  lost: "bg-red-300",
  cancelled: "bg-slate-200",
};

function parse(d: string): Date | null {
  if (!d) return null;
  const t = new Date(d + "T00:00:00");
  return Number.isNaN(t.getTime()) ? null : t;
}

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${p(d.getDate())}`;
}

export function GanttView({ contests }: { contests: Contest[] }) {
  const { min, max, spanDays, todayPct, rows } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dates: Date[] = [today];
    for (const c of contests) {
      const s = parse(c.startDate);
      const d = parse(c.deadline);
      if (s) dates.push(s);
      if (d) dates.push(d);
    }
    const minD = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxD = new Date(Math.max(...dates.map((d) => d.getTime())));
    minD.setDate(minD.getDate() - 3);
    maxD.setDate(maxD.getDate() + 3);
    const span = Math.max(1, Math.round((maxD.getTime() - minD.getTime()) / 86400000));
    const todayPct = ((today.getTime() - minD.getTime()) / (maxD.getTime() - minD.getTime())) * 100;

    const list = contests
      .map((c) => {
        const s = parse(c.startDate);
        const d = parse(c.deadline);
        const left = s ? ((s.getTime() - minD.getTime()) / (maxD.getTime() - minD.getTime())) * 100 : null;
        const right = d ? ((d.getTime() - minD.getTime()) / (maxD.getTime() - minD.getTime())) * 100 : null;
        return { c, left, right, s, d };
      })
      .sort((a, b) => (b.d?.getTime() ?? 0) - (a.d?.getTime() ?? 0));

    return { min: minD, max: maxD, spanDays: span, todayPct, rows: list };
  }, [contests]);

  // 月刻度
  const ticks = useMemo(() => {
    const out: { pos: number; label: string }[] = [];
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    while (cur <= max) {
      const pos = ((cur.getTime() - min.getTime()) / (max.getTime() - min.getTime())) * 100;
      if (pos >= 0 && pos <= 100) out.push({ pos, label: `${cur.getMonth() + 1}月` });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, [min, max]);

  return (
    <div className="card-fluid rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-medium">比赛甘特图</div>
        <div className="text-xs text-slate-400">
          跨度 {ymd(min)} – {ymd(max)}（{spanDays} 天）
        </div>
      </div>

      <div className="relative">
        {/* 月份刻度 */}
        <div className="relative mb-1 h-5">
          {ticks.map((t, i) => (
            <div key={i} className="absolute text-xs text-slate-400" style={{ left: `${t.pos}%` }}>
              <div className="border-l border-slate-200 pl-1">{t.label}</div>
            </div>
          ))}
        </div>

        <div className="relative space-y-2">
          {/* 今天竖线 */}
          <div
            className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-red-400"
            style={{ left: `${todayPct}%` }}
          >
            <span className="absolute -top-1 left-1 rounded bg-red-50 px-1 text-xs font-medium text-red-600">
              今天
            </span>
          </div>

          {rows.map(({ c, left, right, s, d }) => {
            const days = daysUntil(c.deadline);
            const expired = days !== null && days < 0;
            const l = left ?? Math.max(0, todayPct - 6);
            const r = right ?? Math.min(100, todayPct + 6);
            const width = Math.max(1.5, r - l);
            return (
              <div key={c.id} className="group flex items-center gap-3">
                <div className="w-44 shrink-0 truncate text-xs text-slate-600" title={c.name}>
                  {c.name}
                </div>
                <div className="relative h-6 flex-1 rounded bg-slate-50">
                  <div
                    className={`absolute inset-y-1 rounded ${expired ? "bg-slate-300" : BAR_COLORS[c.status] ?? "bg-slate-400"} ${expired ? "opacity-60" : ""}`}
                    style={{ left: `${l}%`, width: `${width}%` }}
                    title={`${c.startDate || "?"} → ${c.deadline || "?"}（${CONTEST_STATUS_LABELS[c.status] ?? c.status}）`}
                  />
                  <span className="absolute inset-y-0 left-0 flex items-center pl-1 text-xs text-slate-400 opacity-0 transition group-hover:opacity-100">
                    {s ? ymd(s) : "?"} → {d ? ymd(d) : "待定"}
                  </span>
                </div>
                <div className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {c.deadline ? (
                    <span className={expired ? "text-slate-400" : days !== null && days <= 14 ? "font-semibold text-red-600" : "text-slate-500"}>
                      {expired ? `过期${-days}天` : `${days}天`}
                    </span>
                  ) : (
                    <span className="text-slate-300">待定</span>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="py-6 text-center text-sm text-slate-400">暂无比赛</div>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
        {Object.entries(BAR_COLORS).map(([k, cls]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-4 rounded ${cls}`} />
            {CONTEST_STATUS_LABELS[k]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-slate-300 opacity-60" />
          已过期
        </span>
      </div>
    </div>
  );
}
