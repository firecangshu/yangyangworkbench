"use client";

import type { NudgeAction, NudgeCard as Nudge } from "@/lib/contest-playbook";

// 按动作类型决定主按钮文案（Task 5/6 接入实际执行；Task 4 先出可交互 UI）
const ACTION_LABEL: Record<NudgeAction, string> = {
  generate_text: "⚡ 助手帮你写",
  invoke_tool: "⚡ 调起 Studio",
  open_link: "🔗 打开报名页",
  open_tool: "🔧 前往连接中心",
  mark_done: "✓ 标记完成",
};

/**
 * 单张 Nudge 引导卡：醒目展示某阶段待办产物，提供「执行」与「跳过」两个动作。
 * 具体执行（助手直出 / 调起引擎 / 打开链接）由父级 onAction 分发，本组件只管渲染与回调。
 */
export function NudgeCard({
  nudge,
  onAction,
  onSkip,
}: {
  nudge: Nudge;
  onAction: (nudge: Nudge) => void;
  onSkip: (taskId: string) => void;
}) {
  return (
    <div className="card-fluid flex items-center gap-3 rounded-xl border border-brand/25 bg-white p-3 shadow-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-lg">
        {nudge.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{nudge.label}</div>
        <div className="truncate text-xs text-slate-500">{nudge.hint}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => onAction(nudge)}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
        >
          {ACTION_LABEL[nudge.action]}
        </button>
        <button
          onClick={() => onSkip(nudge.taskId)}
          title="这一步暂不需要"
          className="rounded-lg border px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        >
          跳过
        </button>
      </div>
    </div>
  );
}
