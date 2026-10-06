/**
 * M30 路演输入包核心（纯 JS 端口）
 * 供 CLI（通道 D）与 MCP（通道 C）两个智能体通道共用，不依赖 Next / Prisma / 运行中的 Web 服务。
 * 语义与 src/lib/contest-playbook.ts、src/lib/roadshow-input.ts 保持一致；TS 侧为 Web 真源，
 * 本文件是独立 node 通道用的等价端口。改 playbook 产物映射时三处需同步。
 */

// status → phase
export const STATUS_TO_PHASE = {
  research: "research", registered: "register", preparing: "prepare",
  submitted: "submit", won: "result", lost: "result", cancelled: "closed", expired: "closed",
};
export function phaseOf(status) {
  return STATUS_TO_PHASE[status] ?? "closed";
}

// 产物组（魔术师 19 种）→ { label, hint }
export const GROUP_ITEMS = {
  pre: [["报名表", "赛事官网报名表填写"], ["简介", "300 字项目简介"], ["一句话", "电梯演讲式定位"], ["声明", "原创性/合规声明"]],
  onstage: [["HTML 路演页", "4+1 风格双语适配"], ["PPT", "竞赛级路演幻灯片"], ["演讲稿", "5 分钟口语化腹稿"], ["图表", "17 种专业图表可选"], ["Demo 操作清单", "展示流程步骤备忘"]],
  qa: [["预测问答", "高频评委问题+应答"], ["答辩备忘录", "技术要点速查卡"], ["技术 FAQ", "常见技术问题解答"], ["红线卡", "绝不可触碰的底线"]],
  after: [["海报", "多主题多尺寸推广海报"], ["社媒文案", "小红书/Twitter 种草"], ["README", "项目开源仓库说明"], ["短视频脚本", "60s Demo 演示分镜"]],
  archive: [["项目档案 JSON", "结构化项目存档"], ["素材包 ZIP", "所有产物一键打包"]],
};
export const PHASE_GROUPS = {
  research: [], register: ["pre"], prepare: ["onstage", "qa"],
  submit: [], result: ["after", "archive"], closed: [],
};

// 阶段集合唯一真源：CLI/MCP 的阶段校验与 zod.enum 均从这里复用，避免多处硬编漂移
export const PHASES = Object.keys(PHASE_GROUPS);

/** 该阶段的待办产物清单（等价于 TS 侧 `nudgesForPhase`，已含 submit 打包特例与 research 工具推荐） */
export function nudgesForPhase(phase) {
  if (phase === "research") {
    return [["竞品/选题调研", "用横纵分析法深度了解赛道"], ["AI 热点速览", "每日 AI 趋势发现选题灵感"]];
  }
  if (phase === "submit") return [["确认打包提交", "检查产物齐全后点提交"]];
  if (phase === "closed") return [];
  const out = [];
  for (const g of PHASE_GROUPS[phase] ?? []) for (const item of GROUP_ITEMS[g]) out.push(item);
  return out;
}

/**
 * 组装魔术师 S1 输入包（Markdown）。
 * @param c 比赛（需含 name/organizer/track/startDate/deadline/status/notes/resultDate）
 * @param projects 关联项目（name/path/summary/tags/lastNote）
 * @param phase 目标阶段
 */
export function buildContestInputPacket(c, projects, phase) {
  const nudges = nudgesForPhase(phase);
  const taskList = nudges.length > 0
    ? nudges.map(([label, hint]) => `  - [ ] ${label}（${hint}）`).join("\n")
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
