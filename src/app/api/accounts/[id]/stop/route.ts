import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { extractProfileDir, isUnderRoot, profileRoot } from "@/lib/launch-profile";

/*
 * 结束该号全部实例（M36.1）：POST /api/accounts/:id/stop
 *
 * 为什么需要：Chromium 单实例锁按用户数据目录为键，同一个号重复点 ▶ 只会聚焦已有窗口，
 * 想把号2 彻底关掉再开一次（或先关掉才能清目录），只能去任务管理器一个个找。
 *
 * 两条铁律：
 * ① 绝不按程序名杀——同一个 exe 往往正是用户自己开着的主实例，按名杀会误伤；
 *    只杀「命令行里带着这个号的用户数据目录」的进程，靠目录定位到号。
 * ② 不拼命令字符串——脚本是下面的字面量常量，而且**目录一个字都不进命令文本**，
 *    靠环境变量 WB_PROFILE_DIR 递给 PowerShell；每个 pid 再用 execFile 数组参数
 *    交给 taskkill，全程不过 shell。
 * （-Command 后面直接追位置参数会被 PowerShell 当成脚本文本解析，报 ParserError——本机实测坑。）
 * 本机 Get-CimInstance 若因权限失败，就把原因如实回给前端，不假装已经关掉了。
 */

/** 只输出匹配到的进程 id，一行一个；目录从环境变量读，不拼进脚本文本 */
const FIND_SCRIPT =
  "$p=$env:WB_PROFILE_DIR; $ErrorActionPreference='SilentlyContinue'; " +
  "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ('*'+$p+'*') } | " +
  "ForEach-Object { $_.ProcessId }";

const ps = (dir: string) =>
  new Promise<{ pids: string[]; stderr: string }>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", FIND_SCRIPT],
      { windowsHide: true, timeout: 20000, env: { ...process.env, WB_PROFILE_DIR: dir } },
      (err, stdout, stderr) => {
        if (err) return resolve({ pids: [], stderr: String(stderr || err).slice(0, 200) });
        resolve({ pids: stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s)), stderr: String(stderr || "").slice(0, 200) });
      }
    );
  });

const killTree = (pid: string) =>
  new Promise<boolean>((resolve) => {
    execFile("taskkill.exe", ["/PID", pid, "/T", "/F"], { windowsHide: true, timeout: 15000 }, (err) => resolve(!err));
  });

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const account = await prisma.connectionAccount.findUnique({ where: { id: Number(id) } });
  if (!account) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const dir = extractProfileDir(account.launchCommand);
  if (!dir) {
    return NextResponse.json({ error: "这个号的命令里没有独立登录空间目录，没法按目录定位它的进程" }, { status: 400 });
  }
  if (!isUnderRoot(dir, profileRoot())) {
    return NextResponse.json({ error: `目录 ${dir} 不在工作台登录空间根下，为安全没有动手` }, { status: 400 });
  }

  const found = await ps(dir);
  if (found.pids.length === 0) {
    return NextResponse.json({
      ok: true,
      killed: 0,
      note: found.stderr
        ? `没能查到进程（${found.stderr}）；这台机器可能不允许按命令行查进程，请手动关掉该号窗口`
        : "这个号现在没有开着的窗口",
    });
  }

  let killed = 0;
  for (const pid of found.pids) {
    if (await killTree(pid)) killed++;
  }
  await prisma.$transaction(async (tx) => {
    await logEvent(tx, "connection_account", account.id, "update", null, {
      stopAccount: { label: account.label, killed, matched: found.pids.length },
    });
  });
  return NextResponse.json({
    ok: true,
    killed,
    matched: found.pids.length,
    note: killed ? `已结束 ${killed} 个该号窗口（只按登录空间目录定位，没按程序名杀）` : "匹配到了进程但都没关掉成功",
  });
}
