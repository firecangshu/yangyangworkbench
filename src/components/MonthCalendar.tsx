"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dayMark, lunarYearLabel } from "@/lib/cn-calendar";
import { deriveMilestones, normDate, type Milestone, type MilestoneType } from "@/lib/contest-playbook";

type ContestBrief = {
  id: number;
  name: string;
  startDate: string;
  deadline: string;
  resultDate: string;
  status: string;
  deliverables: { done: boolean }[];
};

// M31 日历备注/提醒（与 /api/notes 返回结构对齐）
type CalNote = {
  id: number;
  date: string;
  text: string;
  kind: "note" | "reminder";
  done: boolean;
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
  onOpenContest,
}: {
  contests: ContestBrief[];
  // 当日面板里点某场截止比赛 → 交由父级决定跳转/展开（比赛页用；首页可不传）
  onOpenContest?: (id: number) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  // ── M31 备注/提醒：客户端按当月区间取数，两页共用组件自洽，不动父级取数 ──
  const [notes, setNotes] = useState<CalNote[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftKind, setDraftKind] = useState<"note" | "reminder">("note");
  const [editingId, setEditingId] = useState<number | null>(null);

  const monthRange = useMemo(() => {
    const from = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    const to = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    return { from, to };
  }, [cursor]);

  const reload = useCallback(() => {
    fetch(`/api/notes?from=${monthRange.from}&to=${monthRange.to}`)
      .then((r) => r.json())
      .then((ns) => setNotes(Array.isArray(ns) ? ns : []))
      .catch(() => setNotes([]));
  }, [monthRange]);

  useEffect(() => { reload(); }, [reload]);

  // 写库后广播（复用全局 CustomEvent 桥接范式），供首页今日枢纽即时重取待办
  const emitChanged = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("queetai-notes-changed"));
  };

  const byDay = useMemo(() => {
    const map = new Map<string, ContestBrief[]>();
    for (const c of contests) {
      const key = normDate(c.deadline);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
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

  // 备注/提醒按日聚合
  const noteByDay = useMemo(() => {
    const map = new Map<string, CalNote[]>();
    for (const n of notes) {
      const arr = map.get(n.date) ?? [];
      arr.push(n);
      map.set(n.date, arr);
    }
    return map;
  }, [notes]);

  const noDeadline = contests.filter((c) => !normDate(c.deadline));

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

  // ── 备注/提醒 CRUD（写库后即时 reload 回显） ──
  async function submitDraft() {
    if (!openKey) return;
    const text = draftText.trim();
    if (!text) return;
    if (editingId !== null) {
      await fetch(`/api/notes/${editingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, kind: draftKind }),
      });
    } else {
      await fetch("/api/notes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: openKey, text, kind: draftKind }),
      });
    }
    setDraftText(""); setDraftKind("note"); setEditingId(null);
    reload(); emitChanged();
  }
  async function toggleDone(n: CalNote) {
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !n.done }),
    });
    reload(); emitChanged();
  }
  async function removeNote(n: CalNote) {
    await fetch(`/api/notes/${n.id}`, { method: "DELETE" });
    if (editingId === n.id) { setEditingId(null); setDraftText(""); setDraftKind("note"); }
    reload(); emitChanged();
  }
  function startEdit(n: CalNote) {
    setEditingId(n.id); setDraftText(n.text); setDraftKind(n.kind);
  }
  function cancelEdit() { setEditingId(null); setDraftText(""); setDraftKind("note"); }

  const openNotes = openKey ? (noteByDay.get(openKey) ?? []) : [];
  const openItems = openKey ? (byDay.get(openKey) ?? []) : [];

  return (
    <div className="card-fluid rounded-xl bg-white p-2.5 shadow-[0_6px_20px_rgba(31,41,55,0.07)] ring-1 ring-slate-100">
      {/* 标题行：📅 图标 + 粗月份 + 干支年副标题（对齐社工星火区块规范）；导航收为幽灵图标钮 + 赤陶「回今天」
          M26：本卡根元素带 card-fluid，所以卡内字号不再写死 px，而是走全局 text-* 映射（由卡片宽度驱动）：
          月份标题 text-lg / 日期 text-base / 节日节气赛事 text-sm / 农历星期图例 text-xs —— 卡片变宽字同比变大 */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
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
          if (!d) return <div key={`e${i}`} className="min-h-[clamp(50px,6cqi,84px)] rounded-lg bg-slate-50/40" />;
          const key = ymd(d);
          const items = byDay.get(key) ?? [];
          const mss = (msByDay.get(key) ?? []).filter((m) => m.type !== "deadline");
          const cellNotes = noteByDay.get(key) ?? [];
          const hasUndoneRem = cellNotes.some((n) => n.kind === "reminder" && !n.done);
          const hasPlain = cellNotes.some((n) => n.kind === "note" || (n.kind === "reminder" && n.done));
          const isOpen = openKey === key;
          const isToday = key === todayStr;
          const mark = dayMark(d.getFullYear(), d.getMonth(), d.getDate());
          return (
            <button
              key={key}
              onClick={() => setOpenKey(isOpen ? null : key)}
              className={`relative flex min-h-[clamp(50px,6cqi,84px)] flex-col rounded-lg px-1 py-0.5 text-left align-top transition ${
                isOpen ? "ring-2 ring-brand" : ""
              } ${isToday ? "bg-brand text-white shadow-[0_3px_8px_rgba(217,83,79,0.3)]" : "bg-slate-50/60 hover:bg-slate-100"}`}
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
                  {mss.map((m, mi) => (
                    <span
                      key={`${m.contestId}-${m.type}-${mi}`}
                      title={`${m.contestName}（${m.type === "start" ? "启动" : "结果公布"}）`}
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotCls(m)} ${isToday ? "ring-1 ring-white/70" : ""}`}
                    />
                  ))}
                </div>
              )}
              {/* M31 备注/提醒指示点（右下角，不占行高）：未完成提醒=赤陶、备注/已完成=灰 */}
              {cellNotes.length > 0 && (
                <span className="absolute bottom-1 right-1 flex items-center gap-0.5">
                  {hasUndoneRem && <span className="h-1.5 w-1.5 rounded-full bg-brand ring-1 ring-white/60" title="有未完成提醒" />}
                  {hasPlain && <span className="h-1.5 w-1.5 rounded-full bg-slate-400 ring-1 ring-white/60" title="有备注" />}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        <span><span className="text-brand">■</span> 今天</span>
        <span><span className="text-amber-600">■</span> 节日</span>
        <span><span className="text-teal-600">■</span> 节气</span>
        <span><span className="text-brand">◈</span> 赛事截止</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" /> 启动</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-violet-500 align-middle" /> 结果公布</span>
        <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" /> 提醒</span>
        <span><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 align-middle" /> 备注</span>
      </div>

      {/* M31 当日面板：点日期后 dock 在卡下方（避免窄格裁切），上半只读比赛截止、下半备注/提醒增删改 */}
      {openKey && (
        <div className="mt-2 rounded-lg border bg-slate-50/70 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-700">
              {openKey.replace(/-/g, " / ")} · 当日
            </div>
            <button onClick={() => { setOpenKey(null); cancelEdit(); }} className="rounded px-1.5 text-slate-400 hover:bg-slate-200" aria-label="关闭">×</button>
          </div>

          {openItems.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500">赛事截止：</span>
              {openItems.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onOpenContest?.(c.id)}
                  className={`rounded bg-brand-soft px-2 py-0.5 text-xs text-brand ${onOpenContest ? "hover:opacity-80" : "cursor-default"}`}
                >
                  ◈ {c.name}
                </button>
              ))}
            </div>
          )}

          {openNotes.length > 0 && (
            <ul className="mb-2 space-y-1">
              {openNotes.map((n) => (
                <li key={n.id} className="flex items-center gap-2 rounded bg-white px-2 py-1 text-sm ring-1 ring-slate-100">
                  {n.kind === "reminder" ? (
                    <label className="flex shrink-0 items-center gap-1">
                      <input type="checkbox" checked={n.done} onChange={() => toggleDone(n)} className="accent-[var(--brand,#d9534f)]" />
                      <span className="text-[11px] text-slate-400">{n.done ? "已完成" : "待办"}</span>
                    </label>
                  ) : (
                    <span className="shrink-0 text-[11px] text-slate-400">备注</span>
                  )}
                  <span className={`min-w-0 flex-1 truncate ${n.done ? "text-slate-400 line-through" : "text-slate-700"}`} title={n.text}>{n.text}</span>
                  <button onClick={() => startEdit(n)} className="shrink-0 rounded px-1 text-xs text-slate-400 hover:bg-slate-100" aria-label="编辑">✎</button>
                  <button onClick={() => removeNote(n)} className="shrink-0 rounded px-1 text-xs text-red-400 hover:bg-red-50" aria-label="删除">✕</button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitDraft(); }}
              placeholder={editingId !== null ? "编辑内容…" : "给这天记点什么…"}
              className="min-w-0 flex-1 rounded-lg border bg-white px-2 py-1 text-sm"
            />
            <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-200">
              <button onClick={() => setDraftKind("note")} className={`px-2 py-1 text-xs ${draftKind === "note" ? "bg-slate-700 text-white" : "bg-white text-slate-500"}`}>备注</button>
              <button onClick={() => setDraftKind("reminder")} className={`px-2 py-1 text-xs ${draftKind === "reminder" ? "bg-brand text-white" : "bg-white text-slate-500"}`}>提醒</button>
            </div>
            <button onClick={submitDraft} disabled={!draftText.trim()} className="rounded-lg bg-slate-900 px-3 py-1 text-xs text-white enabled:hover:bg-slate-700 disabled:opacity-40">
              {editingId !== null ? "保存" : "添加"}
            </button>
            {editingId !== null && (
              <button onClick={cancelEdit} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">取消</button>
            )}
          </div>
        </div>
      )}

      {noDeadline.length > 0 && (
        <div className="mt-1.5 rounded-lg bg-slate-50 p-2">
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
