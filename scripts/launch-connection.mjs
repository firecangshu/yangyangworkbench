/**
 * 雀台多账号启动卡 · 启动器（M9）
 *
 * 由 /api/connections/:id/launch 以全字面量命令行调起：
 *   node scripts/launch-connection.mjs
 * 目标卡片 id 经 /api 层 /^\d+$/ 校验后写入 .launch-queue，本脚本原子取队列
 * （rename 加锁，防止并发重复启动），逐条以 execFile(参数列表, shell:false) 启动。
 *
 * 安全边界：
 *   - 不经 shell 解释，& | ; 等元字符无注入面
 *   - 不携带、不读取任何凭据；launchCommand 只是「启动方式」（如 --user-data-dir 多开）
 *   - 等同「开始菜单快捷方式」的信任模型，内容可人工审查
 */
import { renameSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "child_process";

const here = dirname(fileURLToPath(import.meta.url));
const queuePath = join(here, ".launch-queue");
const lockPath = join(here, ".launch-queue.lock");

// 原子取队列：改名即加锁；改不动说明另一个启动器正在处理
try {
  renameSync(queuePath, lockPath);
} catch {
  process.exit(0);
}

function splitCommandLine(cmd) {
  const tokens = [];
  let cur = "";
  let inQuote = false;
  for (const ch of cmd.trim()) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) { tokens.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

try {
  const lines = readFileSync(lockPath, "utf-8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^(a|c)?\d+$/.test(s));

  const db = new DatabaseSync(join(here, "..", "prisma", "dev.db"));

  for (const line of lines) {
    /* a 前缀 = 卡内账号；c 前缀 = 打开凭据引用（explorer 定位）；纯数字 = 连接卡本体 */
    const kind = line.startsWith("a") ? "account" : line.startsWith("c") ? "credential" : "connection";
    const id = Number(line.replace(/^(a|c)/, ""));

    let tokens = null;
    if (kind === "credential") {
      const row = db.prepare("SELECT credential_ref FROM Connection WHERE id = ?").get(id);
      const ref = row?.credential_ref?.trim();
      if (!ref) continue;
      tokens = ["explorer.exe", ref];
    } else {
      const row = kind === "account"
        ? db
            .prepare(
              "SELECT a.launch_command, a.label, c.tool_name FROM ConnectionAccount a JOIN Connection c ON c.id = a.connection_id WHERE a.id = ?"
            )
            .get(id)
        : db
            .prepare("SELECT tool_name, launch_command FROM Connection WHERE id = ?")
            .get(id);
      if (!row || !row.launch_command || !row.launch_command.trim()) continue;
      tokens = splitCommandLine(row.launch_command);
    }

    if (kind === "credential") {
      /* 凭据引用：本地路径需真实存在，URL 直接交给 explorer */
      if (!existsSync(tokens[1]) && !/^https?:\/\//.test(tokens[1])) continue;
    } else if (!existsSync(tokens[0])) {
      continue;
    }

    try {
      const child = execFile(tokens[0], tokens.slice(1), {
        shell: false,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      child.on("error", () => {});
    } catch {
      /* 单条启动失败不阻塞队列 */
    }
  }

  db.close();
} finally {
  try {
    unlinkSync(lockPath);
  } catch {
    /* 锁文件已不存在则忽略 */
  }
}
