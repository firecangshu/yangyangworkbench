/**
 * M32 融入管线哨兵：纯函数断言（不触库、不调 LLM）。
 * 验证去重匹配、材料清单 official/sop-fallback、提醒与待定告警、日期归一拒假日期。
 * 成功打印 M32_PASS，失败 exit(1)。
 */
import {
  buildIntegrationPlan,
  matchContest,
  planDeliverables,
  planReminders,
  normName,
  type ExtractedContest,
  type ExistingContest,
} from "../src/lib/contest-integration";

function ok(cond: boolean, msg: string) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) process.exit(1);
}

const base: ExtractedContest = {
  name: "Anker 首届黑客松挑战赛",
  organizer: "Anker",
  track: "智能安防",
  theme: "视觉双模守护",
  content: "eufy 视觉安防黑客松",
  trackAnalysis: "安防赛道竞争激烈",
  startDate: "2026-08-01",
  deadline: "2026-09-27",
  resultDate: "2026-10-10",
  submitLink: "https://example.com/anker",
  notes: "",
  timeNodes: [{ label: "路演", date: "2026-09-25" }],
  requirements: [
    { name: "项目简介", standard: "300字以内" },
    { name: "演示视频", standard: "≤5分钟" },
  ],
  source: "官网粘贴文本……",
};

const existing: ExistingContest[] = [
  { id: 3, name: "Anker黑客松挑战赛", organizer: "Anker", deadline: "2026-09-27" },
  { id: 1, name: "GOSIM Shenzhen 2026", organizer: "GOSIM", deadline: "2026-10-16" },
];

// 1. 名字归一容错
ok(normName("Anker 首届黑客松") === normName("anker首届黑客松"), "normName 去空格大小写");

// 2. 去重匹配：近似赛名 + 主办方 + 截止日一致 → update high
const m = matchContest(base, existing);
ok(m.action === "update" && m.contestId === 3 && m.confidence === "high", `近似名+主办+日期命中 update/high (id=${m.contestId})`);

// 3. 主办方冲突 → update medium（提示核对）
const m2 = matchContest({ ...base, organizer: "别的厂" }, existing);
ok(m2.action === "update" && m2.confidence === "medium", "主办冲突降级 medium");

// 4. 全新赛名 → create
const m3 = matchContest({ ...base, name: "一个从没见过的独立大赛XYZ", organizer: "" }, existing);
ok(m3.action === "create" && m3.confidence === "none", "无同名 → create");

// 5. 材料清单：有 requirements → official
const dl = planDeliverables(base, ["材料递交 · 报名表填写", "赛前分析 · x"]);
ok(dl.source === "official" && dl.items.length === 2 && dl.items[0].name === "项目简介", "requirements → official 材料清单");

// 6. 无 requirements → sop-fallback（仅材料递交段）
const dl2 = planDeliverables({ ...base, requirements: [] }, ["材料递交 · 报名表填写", "材料递交 · 演示材料", "赛前分析 · 无关"]);
ok(dl2.source === "sop-fallback" && dl2.items.length === 2 && dl2.items[0].stage === "submit", "空 requirements → SOP 材料段回退");

// 7. 提醒：含提交截止/结果/启动/路演；假日期不排并告警
const rm = planReminders({ ...base, timeNodes: [{ label: "初筛", date: "2026-02-31" }, { label: "路演", date: "2026-09-25" }] });
ok(rm.reminders.some((r) => r.date === "2026-09-27") && rm.reminders.some((r) => r.date === "2026-10-10"), "正常节点排提醒");
ok(rm.undated.includes("初筛"), "2/31 假日期被拒并进 undated 告警");
ok(!rm.reminders.some((r) => r.date === "2026-02-31" || r.date === "2026-03-03"), "假日期未泄漏成提醒");

// 8. 完整方案：缺字段标待定 + warnings 齐全（不脑补）
const plan = buildIntegrationPlan({ ...base, organizer: "", submitLink: "" }, existing, ["材料递交 · 报名表填写"]);
ok(plan.contest.name === base.name && plan.match.action === "update", "方案含匹配与赛名");
ok(plan.warnings.some((w) => w.includes("待定")) || plan.warnings.some((w) => w.includes("未提供")), "缺字段进待定告警");
ok(plan.contest.status === "research", "无提交链接 → status research（不臆断 registered）");
ok(plan.dossier.requirements.includes("项目简介"), "dossier.requirements 存 JSON");
ok(plan.milestones.length === 3 && plan.milestones.some((x) => x.type === "deadline"), "三里程碑派生");

console.log("M32_PASS");
