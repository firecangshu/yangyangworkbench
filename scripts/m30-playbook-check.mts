/** M30 playbook 哨兵：验证映射/推断逻辑正确。 */
import { GROUP_ITEMS, phaseOf, nudgesForPhase, activeNudges, nextPhasePreview, deriveMilestones, normDate } from "../src/lib/contest-playbook.js";

function assert(cond: boolean, msg: string) { if (!cond) { console.error("FAIL:", msg); process.exit(1); } }

// 19 产物计数
const total = Object.values(GROUP_ITEMS).reduce((s, g) => s + g.length, 0);
assert(total === 19, `产物总数应 19，实得 ${total}`);

// status → phase
assert(phaseOf("preparing") === "prepare", "preparing 应映射 prepare");
assert(phaseOf("won") === "result", "won 应映射 result");
assert(phaseOf("cancelled") === "closed", "cancelled 应映射 closed");
assert(phaseOf("未知xyz") === "closed", "未知 status 应回落 closed");

// prepare 阶段应有 9 张 nudge（onstage 5 + qa 4）
const prepareNudges = nudgesForPhase("prepare");
assert(prepareNudges.length === 9, `prepare 应有 9 nudge，实得 ${prepareNudges.length}`);

// register 阶段应有 4 张（pre 组）
assert(nudgesForPhase("register").length === 4, "register 应 4 nudge");

// research 阶段应有 2 张（工具推荐）
assert(nudgesForPhase("research").length === 2, "research 应 2 nudge");

// submit 阶段应有 1 张
assert(nudgesForPhase("submit").length === 1, "submit 应 1 nudge");

// activeNudges 过滤：done 含 "PPT" 后 prepare 少一张
const filtered = activeNudges(prepareNudges, [{ name: "路演 PPT 已完成", done: true }]);
assert(filtered.length === 8, `prepare 过滤后应 8，实得 ${filtered.length}`);

// deriveMilestones：三个日期各出一里程碑，空日期不出
const ms = deriveMilestones([
  { id: 1, name: "A", startDate: "2026-01-01", deadline: "2026-02-01", resultDate: "2026-03-01", status: "won" },
  { id: 2, name: "B", startDate: "", deadline: "2026-02-01", resultDate: "", status: "preparing" },
]);
assert(ms.length === 4, `里程碑应 4（A×3 + B×deadline），实得 ${ms.length}`);
assert(ms.filter((m) => m.type === "result").length === 1, "result 里程碑应 1");
assert(ms.filter((m) => m.type === "start").length === 1, "start 里程碑应 1（B 无 startDate）");
assert(ms.every((m) => m.date !== ""), "里程碑不得含空日期");
assert(!filtered.some((n) => n.label === "PPT"), "PPT 应被过滤掉");

// nextPhasePreview
assert(nextPhasePreview("prepare")?.phase === "submit", "prepare 下一阶段 submit");
assert(nextPhasePreview("result") === null, "result 无后续");

// normDate 容错：未补零/带时间/非法/越界
assert(normDate("2026-8-1") === "2026-08-01", "未补零应补零");
assert(normDate("2026-08-01T12:30:00Z") === "2026-08-01", "带时间应截取日期部分");
assert(normDate("  2026-08-01  ") === "2026-08-01", "多余空格应 trim");
assert(normDate("乱码xyz") === "", "非法字符串应返回空");
assert(normDate("2026-13-01") === "", "月越界应返回空");
assert(normDate("2026-02-31") === "", "日越界应返回空");
assert(normDate(null) === "" && normDate(undefined) === "", "null/undef 应返回空");

// deriveMilestones 对脏日期：未补零归一后保留、非法跳过
const msDirty = deriveMilestones([
  { id: 9, name: "D", startDate: "2026/8/1", deadline: "2026-9-15", resultDate: "垃圾", status: "won" },
]);
assert(msDirty.length === 1, `脏数据应仅 deadline 入库（start 非法格式被拒），实得 ${msDirty.length}`);
assert(msDirty[0].date === "2026-09-15", "deadline 应归一为 2026-09-15");

console.log("M30_PLAYBOOK_PASS");
