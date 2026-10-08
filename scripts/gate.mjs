/**
 * 提交前门禁链（固化版）：类型检查 + 全部哨兵 + MCP smoke + CLI 自检，一次跑完。
 *
 * 为什么值得固化成仓库脚本：以前每轮都临时重搓一份 _gate.mjs，跑完就删，
 * 于是下一轮又重搓一遍，还容易漏掉某个哨兵。
 *
 * 三条设计约定：
 * ① 九步全跑完再判定，不在第一个失败处退出——一次看清全部问题，省往返。
 * ② 判定只用客观信号：exit code 与「FAIL 」行数（哨兵失败行都以 FAIL 空格开头，
 *    而成功标记是 XXX_PASS，不会被误计）。不猜具体标记名，新增哨兵直接塞进来就行。
 * ③ 零新依赖、零 shell：直接拿 node 跑本地 typescript/tsx 入口。
 *    绕开 npx 是因为 Windows 下它是 npx.cmd，spawn 不过 shell 就找不到。
 *
 * 用法：npm run gate
 *       npm run gate -- --report gate-report.txt   （另存 UTF-8 报告，便于逐字回读）
 *       npm run gate -- --db                       （附带打印各表行数，供核对是否意外写库）
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/ 的上一级即项目根
const NODE = process.execPath;
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** 每一步：相对项目根的脚本 + 传给 node 的参数数组（绝不拼成命令字符串） */
const STEPS = [
  { name: "tsc", args: [TSC, "--noEmit"] },
  { name: "layout-migrate", args: [TSX, "scripts/layout-migrate-check.mts"] },
  { name: "m30-schema", args: [TSX, "scripts/m30-schema-check.mts"] },
  { name: "m30-playbook", args: [TSX, "scripts/m30-playbook-check.mts"] },
  { name: "m32-integration", args: [TSX, "scripts/m32-integration-check.mts"] },
  { name: "m35-webread", args: [TSX, "scripts/m35-webread-check.mts"] },
  { name: "m36-launch-profile", args: [TSX, "scripts/m36-launch-profile-check.mts"] },
  { name: "mcp-smoke", args: ["mcp/smoke-test.mjs"] },
  { name: "cli-selfcheck", args: ["cli/workbench.mjs"] },
];

const flag = (name) => process.argv.includes(`--${name}`);
const reportPath = (() => {
  const i = process.argv.indexOf("--report");
  return i > -1 && process.argv[i + 1] ? join(ROOT, process.argv[i + 1]) : null;
})();

const lines = [];
const push = (s) => {
  lines.push(s);
  console.log(s);
};

/** 附带各表行数：门禁本身不管这个，但改完顺手核对「有没有意外写库」很便宜 */
async function dbCounts() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    // 表名一律照 prisma/schema.prisma 里的 model 写，别凭印象缩略
    // （曾经把 EventLog/LaunchScene/SopStep 猜成 event/scene/sop，结果一片 n/a）
    const names = [
      "connection", "connectionAccount", "contest", "contestProject", "contestDossier",
      "project", "deliverable", "sopTemplate", "sopStep", "launchScene",
      "launchSceneItem", "eventLog", "calendarNote",
    ];
    const out = [];
    for (const n of names) {
      const key = n[0].toLowerCase() + n.slice(1);
      try {
        out.push(`${n}=${await prisma[key].count()}`);
      } catch {
        out.push(`${n}=n/a`);
      }
    }
    await prisma.$disconnect();
    return out;
  } catch (e) {
    return [`DB_UNAVAILABLE ${String(e && e.message).slice(0, 80)}`];
  }
}

if (flag("db")) {
  push("DB_COUNTS " + (await dbCounts()).join(" "));
}

let red = 0;
const started = Date.now();
for (const step of STEPS) {
  const r = spawnSync(NODE, step.args, { cwd: ROOT, encoding: "buffer" });
  // 原始字节按 UTF-8 解码，绝不让 PowerShell/系统 GBK 掺进来（中文输出会糊）
  const text = Buffer.concat([r.stdout || Buffer.alloc(0), r.stderr || Buffer.alloc(0)]).toString("utf8");
  const failLines = text.split(/\r?\n/).filter((l) => l.startsWith("FAIL "));
  const passTokens = [...new Set(text.split(/\r?\n/).map((l) => (l.match(/\b[A-Z0-9_]*PASS\b/) || [])[0]).filter(Boolean))];
  const ok = r.status === 0 && failLines.length === 0;
  if (!ok) red++;
  push(
    `${ok ? "ok  " : "FAIL"} ${step.name.padEnd(20)} exit=${String(r.status).padEnd(3)} ` +
      `FAIL=${failLines.length} ${passTokens.join(",") || "-"}${r.error ? " SPAWN_ERR=" + r.error.message : ""}`
  );
  if (!ok) for (const l of failLines.slice(0, 12)) push(`       ${l}`);
}

push(`GATE ${red === 0 ? "GREEN" : "RED " + red} steps=${STEPS.length} ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (reportPath) {
  writeFileSync(reportPath, lines.join("\n") + "\n", "utf8");
  console.log(`report written: ${reportPath}`);
}
process.exit(red === 0 ? 0 : 1);
