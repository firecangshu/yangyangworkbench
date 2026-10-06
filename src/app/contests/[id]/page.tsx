"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CONTEST_STATUS_LABELS, daysUntil } from "@/lib/constants";
import {
  type NudgeCard as Nudge,
  activeNudges,
  nextPhasePreview,
  nudgesForPhase,
  phaseOf,
  PHASE_LABELS,
} from "@/lib/contest-playbook";
import { PhaseStepper } from "@/components/PhaseStepper";
import { NudgeCard } from "@/components/NudgeCard";

type Deliverable = {
  id: number; contestId: number; name: string; done: boolean;
  doneAt: string | null; stage: string; path: string;
};

// 交付物 stage（产物组）到中文分组名的映射：pre/onstage/qa/after/archive 对应魔术师 5 组
const STAGE_GROUP_LABELS: Record<string, string> = {
  pre: "赛前提报", onstage: "现场展示", qa: "评委互动",
  after: "赛后传播", archive: "存档复用", custom: "自定义", "": "未归类",
};
type Contest = {
  id: number; name: string; organizer: string; track: string;
  startDate: string; deadline: string; resultDate: string; status: string;
  submitLink: string; notes: string;
  deliverables: Deliverable[];
  links: { id: number; project: { id: number; name: string } }[];
};

export default function ContestWorkflowPage() {
  const params = useParams<{ id: string }>();
  const contestId = Number(params?.id);

  const [contest, setContest] = useState<Contest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [showNext, setShowNext] = useState(false);

  const load = useCallback(() => {
    if (!Number.isFinite(contestId)) return;
    fetch("/api/contests")
      .then((r) => r.json())
      .then((all: Contest[]) => setContest(all.find((c) => c.id === contestId) ?? null))
      .finally(() => setLoaded(true));
  }, [contestId]);
  useEffect(() => { load(); }, [load]);

  const phase = contest ? phaseOf(contest.status) : "research";
  const allNudges = useMemo(() => (contest ? nudgesForPhase(phase) : []), [contest, phase]);
  const visibleNudges = useMemo(() => {
    if (!contest) return [];
    const act = activeNudges(allNudges, contest.deliverables);
    return act.filter((n) => !skipped.has(n.taskId));
  }, [contest, allNudges, skipped]);
  const next = contest ? nextPhasePreview(phase) : null;
  const days = contest ? daysUntil(contest.deadline) : null;

  const doneDeliverables = contest?.deliverables.filter((d) => d.done) ?? [];

  function skip(taskId: string) {
    setSkipped((s) => new Set(s).add(taskId));
  }

  // Nudge 动作分发：Task 4 打通「打开链接 / 去连接中心 / 唤起助手」三类即时反应，
  // generate_text 与 invoke_tool 的深度执行（直出登记、调引擎回填）在 Task 5/6 接入。
  function dispatch(nudge: Nudge) {
    if (!contest) return;
    switch (nudge.action) {
      case "open_link":
        if (contest.submitLink) window.open(contest.submitLink, "_blank", "noopener");
        else window.alert("该比赛还没有填写提交/报名链接，先到比赛列表补上。");
        break;
      case "open_tool":
        window.location.href = "/connections";
        break;
      case "generate_text":
        window.dispatchEvent(
          new CustomEvent("assistant-generate", {
            detail: {
              prompt: `【${PHASE_LABELS[phase]}阶段 · ${nudge.label}】${nudge.hint}\n请基于这场比赛与关联项目，帮我生成「${nudge.label}」的初稿。`,
              meta: { contestId: contest.id, deliverableName: nudge.label, stage: nudge.group },
            },
          }),
        );
        break;
      case "invoke_tool":
        window.dispatchEvent(new CustomEvent("open-assistant"));
        window.dispatchEvent(
          new CustomEvent("assistant-invoke-tool", {
            detail: { contestId: contest.id, deliverableName: nudge.label, stage: nudge.group },
          }),
        );
        break;
      case "mark_done":
        // submit 阶段的"确认打包提交"：登记一条已完成交付物
        fetch(`/api/contests/${contest.id}/deliverables`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nudge.label }),
        }).then(() => load());
        break;
    }
  }

  if (!loaded) {
    return <div className="px-2 py-10 text-center text-sm text-slate-400">加载中…</div>;
  }
  if (!contest) {
    return (
      <div className="space-y-3 px-2 py-10 text-center">
        <div className="text-sm text-slate-500">未找到这场比赛。</div>
        <Link href="/contests" className="text-xs text-brand hover:underline">← 返回比赛列表</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 返回 + 标题 */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Link href="/contests" className="hover:text-brand">← 比赛追踪</Link>
        <span>/</span>
        <span className="text-slate-600">{contest.name}</span>
      </div>

      {/* Header */}
      <div className="card-fluid rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{contest.name}</h1>
          <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
            {CONTEST_STATUS_LABELS[contest.status] ?? contest.status}
          </span>
          {days !== null && (
            <span className={`text-xs ${days < 0 ? "text-slate-400" : days <= 7 ? "font-semibold text-red-600" : "text-blue-600"}`}>
              {days < 0 ? `已逾期 ${-days} 天` : `距截止 ${days} 天`}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {contest.organizer && <span>主办方：{contest.organizer}</span>}
          {contest.track && <span>赛道：{contest.track}</span>}
          <span>截止：{contest.deadline || "待定"}</span>
          {contest.resultDate && <span>结果日：{contest.resultDate}</span>}
        </div>
        {contest.notes && <p className="mt-2 text-xs text-slate-500">{contest.notes}</p>}
      </div>

      {/* Stepper */}
      <div className="card-fluid rounded-xl border bg-white p-4">
        <PhaseStepper status={contest.status} />
      </div>

      {/* 当前阶段 Nudge 区 */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {PHASE_LABELS[phase]}阶段 · 待办引导
          </h2>
          {visibleNudges.length > 0 && (
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
              还差 {visibleNudges.length} 项
            </span>
          )}
        </div>
        {visibleNudges.length > 0 ? (
          visibleNudges.map((n) => (
            <NudgeCard key={n.taskId} nudge={n} onAction={dispatch} onSkip={skip} />
          ))
        ) : (
          <div className="card-fluid rounded-xl border bg-white px-4 py-6 text-center text-sm text-slate-400">
            {allNudges.length === 0
              ? "本阶段暂无标准产物引导，可直接查看下方交付物清单。"
              : "本阶段引导项都处理完或跳过了，干得漂亮。"}
          </div>
        )}
      </div>

      {/* 下一阶段预告 */}
      {next && (
        <div className="card-fluid rounded-xl border bg-white">
          <button
            onClick={() => setShowNext((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm text-slate-600"
          >
            <span>下一阶段预告 · {next.label}</span>
            <span className="text-xs text-slate-400">{showNext ? "收起" : "展开"}</span>
          </button>
          {showNext && (
            <div className="flex flex-wrap gap-2 border-t px-4 py-3">
              {nudgesForPhase(next.phase).map((n) => (
                <span key={n.taskId} className="rounded-full border bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                  {n.emoji} {n.label}
                </span>
              ))}
              {nudgesForPhase(next.phase).length === 0 && (
                <span className="text-xs text-slate-400">下一阶段暂无预设产物。</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 交付物全量（按 stage 分组） */}
      <div className="card-fluid rounded-xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          交付物清单 · {doneDeliverables.length}/{contest.deliverables.length} 完成
        </h2>
        {contest.deliverables.length === 0 ? (
          <p className="text-xs text-slate-400">还没有登记交付物。</p>
        ) : (
          <div className="space-y-3">
            {["pre", "onstage", "qa", "after", "archive", "custom", ""].map((stageKey) => {
              const items = contest.deliverables.filter((d) => (d.stage || "") === stageKey);
              if (items.length === 0) return null;
              return (
                <div key={stageKey || "_none"}>
                  <div className="mb-1 text-xs font-medium text-slate-400">{STAGE_GROUP_LABELS[stageKey] ?? stageKey}</div>
                  <ul className="space-y-1">
                      {items.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                          <span className={d.done ? "text-brand" : "text-slate-300"}>{d.done ? "✓" : "○"}</span>
                          <span className={d.done ? "text-slate-400 line-through" : ""}>{d.name}</span>
                          {d.path && d.path !== "assistant-inline" && (
                            <span className="ml-auto truncate text-xs text-slate-400" title={d.path}>📎 {d.path}</span>
                          )}
                          {d.path === "assistant-inline" && (
                            <span className="ml-auto text-xs text-slate-400">🤖 助手直出</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* 关联项目 */}
      {contest.links.length > 0 && (
        <div className="card-fluid rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">关联项目</h2>
          <div className="flex flex-wrap gap-2">
            {contest.links.map((l) => (
              <Link
                key={l.id}
                href="/projects"
                className="inline-flex items-center gap-1 rounded-full border bg-slate-50 px-3 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand"
              >
                📁 {l.project.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
