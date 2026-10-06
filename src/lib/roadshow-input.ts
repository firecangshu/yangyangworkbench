/**
 * M30 输入包生成器：把比赛+关联项目上下文组装为魔术师 S1 输入（Markdown）。
 * 纯函数，无副作用，可 CLI / API / nudge 触发共用。
 */
import type { Phase } from "./contest-playbook";
import { nudgesForPhase } from "./contest-playbook";

export interface PacketContest {
  name: string; organizer: string; track: string;
  startDate: string; deadline: string; status: string;
  notes: string; resultDate: string;
}
export interface PacketProject {
  name: string; path: string; summary: string; tags: string; lastNote: string;
}

export function buildContestInputPacket(
  c: PacketContest,
  projects: PacketProject[],
  phase: Phase,
): string {
  const nudges = nudgesForPhase(phase);
  const taskList = nudges.length > 0
    ? nudges.map((n) => `  - [ ] ${n.label}（${n.hint}）`).join("\n")
    : "  - （本阶段无待办产物）";

  const projBlock = projects.length > 0
    ? projects.map((p) => `### ${p.name}\n- 路径：${p.path || "（未填）"}\n- 摘要：${p.summary || "（未填）"}\n- 标签：${p.tags || "（无）"}\n- 最近更新：${p.lastNote || "（无）"}`).join("\n\n")
    : "- （未关联项目）";

  return `# 路演输入包 · ${c.name}

## 比赛信息
- 主办方：${c.organizer || "（未填）"}
- 赛道：${c.track || "（未填）"}
- 起止：${c.startDate || "（未填）"} ~ ${c.deadline || "待定"}
- 结果日：${c.resultDate || "（待定）"}
- 当前阶段：${phase}
- 备注：${c.notes || "（无）"}

## 关联项目
${projBlock}

## 本次要生成的产物
${taskList}

## 视觉风格偏好
（留空 = 默认暗色科技风）

---
> 此输入包由雀台 M30 自动生成。魔术师/IDE Skill 读取后可直接跳入 S2 信息核对步骤。`;
}
