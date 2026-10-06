/**
 * M30 比赛阶段 playbook：纯常量 + 纯函数，不入库、不依赖外部模块。
 * 职责：status → Phase → NudgeCard 推断，供工作流页与首页枢纽消费。
 */

// ─── 类型 ──────────────────────────────────────────────────────────────
export type Phase = "research" | "register" | "prepare" | "submit" | "result" | "closed";
export type ProductGroup = "pre" | "onstage" | "qa" | "after" | "archive";
export type NudgeAction = "generate_text" | "invoke_tool" | "open_link" | "open_tool" | "mark_done";

export interface NudgeCard {
  taskId: string;
  label: string;
  hint: string;
  group: ProductGroup;
  phase: Phase;
  action: NudgeAction;
  emoji: string;
}

// ─── 阶段映射 ─────────────────────────────────────────────────────────
export const PHASE_LABELS: Record<Phase, string> = {
  research: "调研", register: "提报", prepare: "备赛", submit: "提交",
  result: "结果·传播", closed: "终态",
};

export const STATUS_TO_PHASE: Record<string, Phase> = {
  research: "research",
  registered: "register",
  preparing: "prepare",
  submitted: "submit",
  won: "result",
  lost: "result",
  cancelled: "closed",
  expired: "closed",
};

export function phaseOf(status: string): Phase {
  return STATUS_TO_PHASE[status] ?? "closed";
}

// ─── 产物组（魔术师 19 种） ─────────────────────────────────────────────
export const GROUP_ITEMS: Record<ProductGroup, string[]> = {
  pre: ["报名表", "简介", "一句话", "声明"],
  onstage: ["HTML 路演页", "PPT", "演讲稿", "图表", "Demo 操作清单"],
  qa: ["预测问答", "答辩备忘录", "技术 FAQ", "红线卡"],
  after: ["海报", "社媒文案", "README", "短视频脚本"],
  archive: ["项目档案 JSON", "素材包 ZIP"],
};

export const PHASE_GROUPS: Record<Phase, ProductGroup[]> = {
  research: [],
  register: ["pre"],
  prepare: ["onstage", "qa"],
  submit: [],
  result: ["after", "archive"],
  closed: [],
};

// ─── Nudge 完整定义 ────────────────────────────────────────────────────
const NUDGE_META: Record<string, { emoji: string; hint: string; action: NudgeAction }> = {
  // pre
  "报名表": { emoji: "📋", hint: "赛事官网报名表填写", action: "open_link" },
  "简介": { emoji: "📝", hint: "300 字项目简介", action: "generate_text" },
  "一句话": { emoji: "💬", hint: "电梯演讲式定位", action: "generate_text" },
  "声明": { emoji: "📜", hint: "原创性/合规声明", action: "generate_text" },
  // onstage
  "HTML 路演页": { emoji: "🌐", hint: "4+1 风格双语适配", action: "invoke_tool" },
  "PPT": { emoji: "🎯", hint: "竞赛级路演幻灯片", action: "invoke_tool" },
  "演讲稿": { emoji: "🎤", hint: "5 分钟口语化腹稿", action: "generate_text" },
  "图表": { emoji: "📊", hint: "17 种专业图表可选", action: "invoke_tool" },
  "Demo 操作清单": { emoji: "🖥", hint: "展示流程步骤备忘", action: "generate_text" },
  // qa
  "预测问答": { emoji: "❓", hint: "高频评委问题+应答", action: "generate_text" },
  "答辩备忘录": { emoji: "🛡", hint: "技术要点速查卡", action: "generate_text" },
  "技术 FAQ": { emoji: "🔧", hint: "常见技术问题解答", action: "generate_text" },
  "红线卡": { emoji: "🚫", hint: "绝不可触碰的底线", action: "generate_text" },
  // after
  "海报": { emoji: "🖼", hint: "多主题多尺寸推广海报", action: "invoke_tool" },
  "社媒文案": { emoji: "📱", hint: "小红书/Twitter 种草", action: "generate_text" },
  "README": { emoji: "📄", hint: "项目开源仓库说明", action: "generate_text" },
  "短视频脚本": { emoji: "🎬", hint: "60s Demo 演示分镜", action: "generate_text" },
  // archive
  "项目档案 JSON": { emoji: "🗃", hint: "结构化项目存档", action: "invoke_tool" },
  "素材包 ZIP": { emoji: "📦", hint: "所有产物一键打包", action: "invoke_tool" },
};

// research 阶段特殊 nudge（工具推荐，不属 19 产物）
const RESEARCH_NUDGES: NudgeCard[] = [
  { taskId: "research.hv-analysis", label: "竞品/选题调研", hint: "用横纵分析法深度了解赛道", group: "pre", phase: "research", action: "open_tool", emoji: "🔭" },
  { taskId: "research.aihot", label: "AI 热点速览", hint: "每日 AI 趋势发现选题灵感", group: "pre", phase: "research", action: "open_tool", emoji: "🔥" },
];

export function buildNudgesForPhase(phase: Phase): NudgeCard[] {
  if (phase === "research") return RESEARCH_NUDGES;
  if (phase === "closed" || phase === "submit") return [];
  const groups = PHASE_GROUPS[phase] ?? [];
  const nudges: NudgeCard[] = [];
  for (const g of groups) {
    for (const name of GROUP_ITEMS[g]) {
      const meta = NUDGE_META[name] ?? { emoji: "📌", hint: "", action: "mark_done" as NudgeAction };
      nudges.push({ taskId: `${phase}.${name}`, label: name, hint: meta.hint, group: g, phase, action: meta.action, emoji: meta.emoji });
    }
  }
  return nudges;
}

/** 供 submit 阶段的简易"打包提交" nudge */
export function submitNudge(): NudgeCard {
  return { taskId: "submit.pack", label: "确认打包提交", hint: "检查产物齐全后点提交", group: "pre", phase: "submit", action: "mark_done", emoji: "📦" };
}

// ─── Nudge 推断：过滤已完成的 ──────────────────────────────────────────
/**
 * 从全量 nudge 列表中去除已有对应 done 交付物的项。
 * 匹配逻辑：deliverable.name 包含 nudge.label 即视为已覆盖。
 */
export function activeNudges(
  allNudges: NudgeCard[],
  doneDeliverables: { name: string; done: boolean }[],
): NudgeCard[] {
  const doneNames = doneDeliverables.filter((d) => d.done).map((d) => d.name.toLowerCase());
  return allNudges.filter((n) => !doneNames.some((dn) => dn.includes(n.label.toLowerCase())));
}

// ─── 里程碑派生（供日历/甘特消费；纯函数，不入库） ─────────────────────
export type MilestoneType = "start" | "deadline" | "result";

export interface Milestone {
  date: string;
  type: MilestoneType;
  contestId: number;
  contestName: string;
  status: string;
}

export const MILESTONE_LABEL: Record<MilestoneType, string> = {
  start: "启动", deadline: "截止", result: "结果公布",
};

/**
 * 日期归一：把各种脏输入（多余空格 / ISO 带时间 / yyyy-M-d 未补零）收敛成
 * 规范的 "yyyy-MM-dd"；非法或越界（月 1-12、日 1-31、无法解析）一律返回 ""。
 * 供里程碑派生与日历/甘特消费端共用，避免格式漂移导致漏配。
 */
export function normDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = String(raw).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = `${y}-${p(mo)}-${p(d)}`;
  // 日历级回验：拒绝 2/31、4/31 等“该月不存在”的假日期（new Date 会把它们滚动到下月）
  const dt = new Date(iso + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return "";
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return "";
  return iso;
}

/**
 * 从比赛派生三类里程碑：startDate=启动、deadline=截止、resultDate=结果公布。
 * 日期经 normDate 归一，非法/空值自动跳过，供月历圆点与甘特分段染色共用同一份语义。
 */
export function deriveMilestones(
  contests: { id: number; name: string; startDate: string; deadline: string; resultDate: string; status: string }[],
): Milestone[] {
  const out: Milestone[] = [];
  for (const c of contests) {
    const start = normDate(c.startDate);
    const deadline = normDate(c.deadline);
    const result = normDate(c.resultDate);
    if (start) out.push({ date: start, type: "start", contestId: c.id, contestName: c.name, status: c.status });
    if (deadline) out.push({ date: deadline, type: "deadline", contestId: c.id, contestName: c.name, status: c.status });
    if (result) out.push({ date: result, type: "result", contestId: c.id, contestName: c.name, status: c.status });
  }
  return out;
}

// ─── 下一阶段预告 ──────────────────────────────────────────────────────
const PHASE_ORDER: Phase[] = ["research", "register", "prepare", "submit", "result"];

export function nextPhasePreview(phase: Phase): { phase: Phase; label: string } | null {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  const next = PHASE_ORDER[idx + 1];
  return { phase: next, label: PHASE_LABELS[next] };
}

// ─── 辅助：获取该 phase 的 nudge 数量（含 submit 特殊处理）────────────────
export function nudgesForPhase(phase: Phase): NudgeCard[] {
  if (phase === "submit") return [submitNudge()];
  return buildNudgesForPhase(phase);
}
