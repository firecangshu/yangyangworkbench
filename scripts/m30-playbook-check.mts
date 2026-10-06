/** M30 playbook 哨兵：验证映射/推断逻辑正确。 */
import { GROUP_ITEMS, phaseOf, nudgesForPhase, activeNudges, nextPhasePreview } from "../src/lib/contest-playbook.js";

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
assert(filtered.length === 8, `过滤后应 8，实得 ${filtered.length}`);
assert(!filtered.some((n) => n.label === "PPT"), "PPT 应被过滤掉");

// nextPhasePreview
assert(nextPhasePreview("prepare")?.phase === "submit", "prepare 下一阶段 submit");
assert(nextPhasePreview("result") === null, "result 无后续");

console.log("M30_PLAYBOOK_PASS");
