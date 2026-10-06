"use client";

import { useMemo } from "react";
import { CONTEST_STATUS_LABELS, daysUntil } from "@/lib/constants";

type Contest = {
  id: number;
  name: string;
  startDate: string;
  deadline: string;
  resultDate: string;
  status: string;
};

// 时间轴分段：备赛段(startDate→deadline) + 结果段(deadline→resultDate)
type Seg = { left: number; width: number; cls: string; label: string };

const SEG_PREPARE = "bg-amber-400"; // 备赛段
const SEG_PENDING = "bg-sky-400"; // 提交后等待公布
const SEG_WON = "bg-emerald-500"; // 已获奖
const SEG_LOST = "bg-red-400"; // 未中

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
      const r = parse(c.resultDate);
      if (s) dates.push(s);
      if (d) dates.push(d);
      if (r) dates.push(r);
    }
    const minD = new Date(Math.min(...dates.map((x) => x.getTime())));
    const maxD = new Date(Math.max(...dates.map((x) => x.getTime())));
    minD.setDate(minD.getDate() - 3);
    maxD.setDate(maxD.getDate() + 3);
    const span = Math.max(1, Math.round((maxD.getTime() - minD.getTime()) / 86400000));
    const pct = (t: Date) => ((t.getTime() - minD.getTime()) / (maxD.getTime() - minD.getTime())) * 100;
    const todayPct = pct(today);

    const list = contests
      .map((c) => {
        const s = parse(c.startDate);
        const d = parse(c.deadline);
        const r = parse(c.resultDate);
        const days = daysUntil(c.deadline);
        const expired = days !== null && days < 0 && !r;

        const segs: Seg[] = [];
        // 备赛段：startDate → deadline
        if (s && d) {
          const l = pct(s);
          const w = Math.max(1, pct(d) - l);
          segs.push({ left: l, width: w, cls: expired ? "bg-slate-300" : SEG_PREPARE, label: "备赛" });
        }
        // 结果段：deadline → resultDate，颜色随胜负
        if (d && r) {
          const l = pct(d);
          const w = Math.max(1, pct(r) - l);
          const cls = c.status === "won" ? SEG_WON : c.status === "lost" ? SEG_LOST : SEG_PENDING;
          const label = c.status === "won" ? "已获奖" : c.status === "lost" ? "未中" : "等待公布";
          segs.push({ left: l, width: w, cls, label });
        }
        // 兜底：无任何可算区间时，在今天附近画一小段"日期待定"
        if (segs.length === 0) {
          segs.push({ left: Math.max(0, todayPct - 4), width: 4, cls: "bg-slate-300", label: "日期待定" });
        }

        const sortKey = r?.getTime() ?? d?.getTime() ?? s?.getTime() ?? 0;
        return { c, s, d, r, segs, expired, sortKey };
      })
      .sort((a, b) => b.sortKey - a.sortKey);

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

          {rows.map(({ c, s, d, r, segs, expired }) => {
            const days = daysUntil(c.deadline);
            const past = days !== null && days < 0;
            return (
              <div key={c.id} className="group flex items-center gap-3">
                <div className="w-44 shrink-0 truncate text-xs text-slate-600" title={c.name}>
                  {c.name}
                </div>
                <div className="relative h-6 flex-1 rounded bg-slate-50">
                  {/* 分段条：备赛段 + 结果段（各自按真实日期落位） */}
                  {segs.map((seg, i) => (
                    <div
                      key={i}
                      className={`absolute inset-y-1 ${seg.cls} ${expired ? "opacity-60" : ""}`}
                      style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                      title={`${seg.label}：${c.startDate || "?"} → ${c.deadline || "待定"}${c.resultDate ? ` → 结果 ${c.resultDate}` : ""}（${CONTEST_STATUS_LABELS[c.status] ?? c.status}）`}
                    />
                  ))}
                  <span className="absolute inset-y-0 left-0 z-20 flex items-center pl-1 text-xs text-slate-500 opacity-0 transition group-hover:opacity-100">
                    {s ? ymd(s) : "?"} → {d ? ymd(d) : "待定"}{r ? ` → 结果 ${ymd(r)}` : ""}
                  </span>
                </div>
                <div className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {c.deadline && days !== null ? (
                    <span className={past ? "text-slate-400" : days <= 14 ? "font-semibold text-red-600" : "text-slate-500"}>
                      {past ? `过期${-days}天` : `${days}天`}
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
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-2 w-4 rounded ${SEG_PREPARE}`} />
          备赛段
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-2 w-4 rounded ${SEG_PENDING}`} />
          等待公布
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-2 w-4 rounded ${SEG_WON}`} />
          已获奖
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`inline-block h-2 w-4 rounded ${SEG_LOST}`} />
          未中
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-slate-300 opacity-60" />
          已过期
        </span>
      </div>
    </div>
  );
}
