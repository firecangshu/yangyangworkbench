/**
 * 雀台截止提醒（M10）—— Windows 计划任务每日调用
 *   node scripts/deadline-notify.mjs
 * node:sqlite 直读 dev.db，无需 dev server。对未终结的比赛：
 *   截止前 7/3/1/0 天各弹一次 Windows toast（状态文件防重复）。
 * 提示语基准：绝不脑补——只报告台账里的日期事实。
 */
import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execFile } from "child_process";

const here = dirname(fileURLToPath(import.meta.url));
const statePath = join(here, ".deadline-state.json");

const TERMINAL = new Set(["expired", "cancelled", "lost", "submitted", "won"]);
const THRESHOLDS = [7, 3, 1, 0];

function loadState() {
  try { return JSON.parse(readFileSync(statePath, "utf-8")); } catch { return {}; }
}
function saveState(s) {
  writeFileSync(statePath, JSON.stringify(s, null, 2), "utf-8");
}
function daysUntil(dateStr) {
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

const db = new DatabaseSync(join(here, "..", "prisma", "dev.db"));
const rows = db
  .prepare("SELECT id, name, deadline, status FROM Contest WHERE deadline != ''")
  .all();
db.close();

const state = loadState();
const due = [];
for (const r of rows) {
  if (TERMINAL.has(r.status)) continue;
  const days = daysUntil(r.deadline);
  if (days === null || !THRESHOLDS.includes(days)) continue;
  const key = `${r.id}:${days}`;
  if (state[key]) continue;
  state[key] = new Date().toISOString();
  due.push({ name: r.name, deadline: r.deadline, days });
}
saveState(state);

if (due.length === 0) {
  console.log("no deadlines due today");
  process.exit(0);
}

const title = "tagex · 比赛截止提醒";
const body = due
  .map((d) => `【${d.days === 0 ? "今天" : `还剩 ${d.days} 天`}】${d.name}（${d.deadline}）`)
  .join("\n");
console.log("notify:\n" + body);

/* 通过 Windows toast 弹出（AppId 用 PowerShell 以获得合法通知源） */
const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$titles = $t.GetElementsByTagName("text")
$titles.Item(0).AppendChild($t.CreateTextNode([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(title, "utf-8").toString("base64")}')))) | Out-Null
$titles.Item(1).AppendChild($t.CreateTextNode([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(body, "utf-8").toString("base64")}')))) | Out-Null
$n = [Windows.UI.Notifications.ToastNotification]::new($t)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)
`;
execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { shell: false, windowsHide: true }, (err) => {
  if (err) console.error("toast failed:", String(err).slice(0, 200));
});
