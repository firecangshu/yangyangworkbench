"use client";

import { PHASE_LABELS, phaseOf, type Phase } from "@/lib/contest-playbook";

// 五段式阶段链（closed 不在内：cancelled/expired 走单独终态提示）
const PHASE_ORDER: Phase[] = ["research", "register", "prepare", "submit", "result"];

/**
 * 比赛全生命周期 stepper：当前阶段赤陶高亮、已完成打勾、未来灰。
 * 纯展示组件，不发起请求、不依赖数据层，status 由父级从 Contest 传入。
 */
export function PhaseStepper({ status }: { status: string }) {
  const current = phaseOf(status);
  const closed = current === "closed";
  const currentIdx = closed ? -1 : PHASE_ORDER.indexOf(current);

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {PHASE_ORDER.map((phase, i) => {
        const isCurrent = !closed && i === currentIdx;
        const isDone = !closed && currentIdx >= 0 && i < currentIdx;
        return (
          <div key={phase} className="flex shrink-0 items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                isCurrent
                  ? "bg-brand font-semibold text-white"
                  : isDone
                    ? "bg-brand-soft text-brand"
                    : "border bg-white text-slate-400"
              }`}
            >
              <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                isCurrent ? "bg-white/25" : isDone ? "bg-brand text-white" : "bg-slate-100 text-slate-400"
              }`}>
                {isDone ? "✓" : i + 1}
              </span>
              {PHASE_LABELS[phase]}
            </div>
            {i < PHASE_ORDER.length - 1 && (
              <span className={`h-px w-4 shrink-0 ${isDone ? "bg-brand/40" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
      {closed && (
        <span className="ml-2 shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500">
          该比赛已处于终态（{status === "cancelled" ? "已取消" : "已过期"}）
        </span>
      )}
    </div>
  );
}
