/**
 * 工作台自动备份（M10）—— Windows 计划任务每日调用
 *   node scripts/auto-backup.mjs
 * 与手动备份 API 同源同构：dev.db 单文件副本 + manifest.json 计数快照。
 * 独立于 dev server（node:sqlite 直读计数），保留最近 14 份自动备份。
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dbPath = join(root, "prisma", "dev.db");
const backupRoot = join(root, "backups");
const KEEP = 14;

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").slice(0, 12);
const dir = join(backupRoot, `auto-${stamp}`);
if (existsSync(dir)) {
  console.log(`already backed up this minute: ${dir}`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });

/* 先读计数（源库），再复制文件 */
const db = new DatabaseSync(dbPath);
const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const counts = {
  projects: count("Project"),
  contests: count("Contest"),
  deliverables: count("Deliverable"),
  connections: count("Connection"),
  accounts: count("ConnectionAccount"),
  sops: count("SopTemplate"),
  events: count("EventLog"),
};
db.close();

copyFileSync(dbPath, join(dir, "workbench.db"));
writeFileSync(
  join(dir, "manifest.json"),
  JSON.stringify({ type: "auto", createdAt: new Date().toISOString(), counts, dbCopied: true }, null, 2),
  "utf-8"
);

/* 清理：只删 auto-* 前缀，保留最近 KEEP 份（不动手动备份 backup-*） */
const autos = readdirSync(backupRoot)
  .filter((n) => n.startsWith("auto-") && existsSync(join(backupRoot, n, "manifest.json")))
  .sort()
  .reverse();
for (const old of autos.slice(KEEP)) {
  rmSync(join(backupRoot, old), { recursive: true, force: true });
  console.log("pruned:", old);
}

console.log(`backup ok: ${dir} (projects=${counts.projects} contests=${counts.contests} events=${counts.events})`);
