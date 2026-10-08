/**
 * M32 赛事融入管线（纯函数，客户端安全，可单测）。
 * 职责：把 AI 助手从「用户提供的官网资讯」抽取出的结构化字段，
 *   1) 去重匹配现有比赛（赛名/主办方/日期比对 → 新建 or 对齐更新），
 *   2) 组装「融入方案预览」（要建/更的 Contest + Deliverable 材料项 + 日历提醒节点 + 里程碑），
 *   3) 汇总缺项/待定告警，供预览红字提示。
 * 本模块【绝不写库、绝不调 LLM】——落库由 /api/integrate 在用户确认后执行（方案甲 + 红线②④）。
 * 仅依赖同层纯模块 contest-playbook 的 normDate，保持与日历/甘特同一份日期语义。
 */
import { normDate } from "./contest-playbook";

export const TBD = "待定";

/** AI 抽取的单个时间节点（报名/初筛/提交/路演/公布…）；date 未给出时留 "" */
export interface TimeNode {
  label: string;
  date: string;
}
/** 官方递交要求条目 */
export interface Requirement {
  name: string;
  standard?: string;
  deadline?: string;
  source?: string;
}

/** 助手抽取后的规范化比赛草稿 */
export interface ExtractedContest {
  name: string;
  organizer: string;
  track: string;
  theme: string;
  content: string;
  trackAnalysis: string;
  startDate: string;
  deadline: string;
  resultDate: string;
  submitLink: string;
  notes: string;
  timeNodes: TimeNode[];
  requirements: Requirement[];
  /** 用户提供的原始资讯存档（进 Dossier.source） */
  source: string;
}

/** 用于去重比对的现有比赛最小集 */
export interface ExistingContest {
  id: number;
  name: string;
  organizer: string;
  deadline: string;
}

export interface MatchResult {
  action: "create" | "update";
  contestId?: number;
  matchedName?: string;
  confidence: "high" | "medium" | "none";
  reason: string;
}

export interface PlanDeliverable {
  name: string;
  stage: string;
  standard: string;
}
export interface PlanReminder {
  date: string;
  text: string;
}
export interface PlanMilestone {
  date: string;
  type: "start" | "deadline" | "result";
  label: string;
}

export interface IntegrationPlan {
  match: MatchResult;
  contest: {
    name: string;
    organizer: string;
    track: string;
    startDate: string;
    deadline: string;
    resultDate: string;
    submitLink: string;
    status: string;
    notes: string;
  };
  dossier: {
    timeInfo: string; // JSON
    content: string;
    theme: string;
    trackAnalysis: string;
    requirements: string; // JSON
    source: string;
  };
  deliverables: PlanDeliverable[];
  deliverableSource: "official" | "sop-fallback";
  reminders: PlanReminder[];
  milestones: PlanMilestone[];
  warnings: string[];
}

/** 归一化比赛名：去空白/常见分隔/大小写，便于容错比对（"Anker 首届黑客松" ≈ "Anker黑客松"） */
export function normName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s\-_·．.、,，:：()（）【】\[\]"'“”]/g, "")
    .trim();
}

/** 两名字是否近似同指一赛：归一后用字符重合度（overlap coefficient），
 * 对「首届」「2026」等插入/后缀词鲁棒；短名（唯一字符 <4）要求完全相等，避免误伤 */
function nameSimilar(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const A = new Set(Array.from(na));
  const B = new Set(Array.from(nb));
  if (A.size < 4 || B.size < 4) return false;
  let inter = 0;
  for (const c of A) if (B.has(c)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.82;
}

/** 去重匹配：优先赛名近似 + 主办方一致/缺失 + 截止日一致，给出新建/对齐判定与置信度 */
export function matchContest(ex: ExtractedContest, existing: ExistingContest[]): MatchResult {
  const exDeadline = normDate(ex.deadline);
  for (const c of existing) {
    if (nameSimilar(ex.name, c.name)) {
      const orgMatch = !ex.organizer || !c.organizer || normName(ex.organizer) === normName(c.organizer);
      const dateMatch = !exDeadline || !c.deadline || normDate(c.deadline) === exDeadline;
      if (orgMatch && dateMatch) {
        return {
          action: "update", contestId: c.id, matchedName: c.name, confidence: "high",
          reason: `赛名与「${c.name}」高度一致，主办方/截止日匹配`,
        };
      }
      return {
        action: "update", contestId: c.id, matchedName: c.name, confidence: "medium",
        reason: `赛名近似「${c.name}」，但主办方或截止日有出入，请核对是否为同一赛`,
      };
    }
  }
  return { action: "create", confidence: "none", reason: "台账中无同名/近似赛，按新建处理" };
}

/** 材料递交段的通用底稿步骤（SOP fallback 时用作 Deliverable） */
export function sopMaterialSteps(allSteps: string[]): string[] {
  return allSteps.filter((s) => s.startsWith("材料递交"));
}

/** 依据 requirements 生成材料清单；无官方 requirements 时回退 SOP 材料递交步骤 */
export function planDeliverables(
  ex: ExtractedContest,
  sopSteps: string[],
): { items: PlanDeliverable[]; source: "official" | "sop-fallback" } {
  if (ex.requirements.length > 0) {
    const items = ex.requirements
      .map((r) => ({
        name: String(r.name ?? "").trim() || TBD,
        stage: "submit",
        standard: String(r.standard ?? "").trim() || String(r.source ?? "").trim() || TBD,
      }))
      .filter((it) => it.name && it.name !== TBD);
    if (items.length > 0) return { items, source: "official" };
  }
  const items = sopMaterialSteps(sopSteps).map((s) => ({
    name: s.replace(/^材料递交\s*·\s*/, ""),
    stage: "submit",
    standard: TBD,
  }));
  return { items, source: "sop-fallback" };
}

/** 时间节点 → 日历提醒（date 已 normDate；空日期不排提醒但进 warnings） */
export function planReminders(ex: ExtractedContest): { reminders: PlanReminder[]; undated: string[] } {
  const reminders: PlanReminder[] = [];
  const undated: string[] = [];
  const seen = new Set<string>();
  const add = (label: string, raw: string | undefined) => {
    const d = normDate(raw ?? "");
    if (!d) {
      if (label) undated.push(label);
      return;
    }
    const key = `${d}|${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    reminders.push({ date: d, text: `${label}｜${ex.name || TBD}` });
  };
  add("提交截止", ex.deadline);
  add("结果公布", ex.resultDate);
  add("启动", ex.startDate);
  for (const n of ex.timeNodes) add(n.label, n.date);
  reminders.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { reminders, undated };
}

/** 里程碑：与月历/甘特 deriveMilestones 同语义（start/deadline/result） */
export function planMilestones(ex: ExtractedContest): PlanMilestone[] {
  const out: PlanMilestone[] = [];
  const start = normDate(ex.startDate);
  const deadline = normDate(ex.deadline);
  const result = normDate(ex.resultDate);
  if (start) out.push({ date: start, type: "start", label: "启动" });
  if (deadline) out.push({ date: deadline, type: "deadline", label: "截止" });
  if (result) out.push({ date: result, type: "result", label: "结果公布" });
  return out;
}

/** 状态推断：有截止且已过→expired 交给上层？此处只做轻推断——填了提交链接/报名→registered，否则 research */
export function inferStatus(ex: ExtractedContest): string {
  return ex.submitLink.trim() ? "registered" : "research";
}

/** 组装完整融入方案预览 */
export function buildIntegrationPlan(
  ex: ExtractedContest,
  existing: ExistingContest[],
  sopSteps: string[],
): IntegrationPlan {
  const match = matchContest(ex, existing);
  const { items: deliverables, source } = planDeliverables(ex, sopSteps);
  const { reminders, undated } = planReminders(ex);
  const milestones = planMilestones(ex);

  const warnings: string[] = [];
  if (!ex.name.trim()) warnings.push("比赛名称缺失，无法融入，请先补全");
  if (match.action === "update" && match.confidence === "medium") warnings.push(match.reason);
  const fieldMissing: string[] = [];
  if (!ex.organizer.trim()) fieldMissing.push("主办方");
  if (!normDate(ex.startDate)) fieldMissing.push("开始日期");
  if (!normDate(ex.deadline)) fieldMissing.push("截止日期");
  if (!ex.submitLink.trim()) fieldMissing.push("提交链接");
  if (fieldMissing.length) warnings.push(`以下项资料未提供，已标「待定」，可融入后补：${fieldMissing.join("、")}`);
  if (undated.length) warnings.push(`时间节点无确切日期，未排提醒：${undated.join("、")}`);
  if (source === "sop-fallback") warnings.push("官方递交要求未抽取到，材料清单暂用标准手册通用底稿，请核对");

  return {
    match,
    contest: {
      name: ex.name.trim(),
      organizer: ex.organizer.trim(),
      track: ex.track.trim(),
      startDate: normDate(ex.startDate),
      deadline: normDate(ex.deadline),
      resultDate: normDate(ex.resultDate),
      submitLink: ex.submitLink.trim(),
      status: inferStatus(ex),
      notes: ex.notes.trim(),
    },
    dossier: {
      timeInfo: JSON.stringify(ex.timeNodes.map((n) => ({ label: n.label, date: normDate(n.date) || TBD }))),
      content: ex.content.trim() || TBD,
      theme: ex.theme.trim() || TBD,
      trackAnalysis: ex.trackAnalysis.trim() || TBD,
      requirements: JSON.stringify(ex.requirements),
      source: ex.source,
    },
    deliverables,
    deliverableSource: source,
    reminders,
    milestones,
    warnings,
  };
}
