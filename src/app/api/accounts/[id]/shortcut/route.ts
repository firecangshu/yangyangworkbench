import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { profileRoot } from "@/lib/launch-profile";
import { accountColor, shortcutName } from "@/lib/account-color";
import { buildAccountIco } from "@/lib/account-icon";

/**
 * 桌面快捷方式（M36.2）：给某个号在桌面上立一块带颜色的门牌。
 *
 *   POST   /api/accounts/:id/shortcut —— 生成该号配色的 .ico + 桌面 .lnk
 *   DELETE /api/accounts/:id/shortcut —— 撤掉它（按登记表找回并删除）
 *
 * 三条安全约定：
 * ① .lnk 的执行体是 scripts/shortcut-launch.mjs，它回头去调 launch API，
 *    所以快捷方式不可能绕过启动队列与审计日志。
 * ② PowerShell 脚本全是下面的字面量常量，路径与文案一律走环境变量递进，
 *    命令文本里不拼任何来自数据库或请求的内容。
 * ③ 删除动作只认「工作台- 前缀 + 无路径分隔符 + .lnk 结尾」的文件名，且由
 *    PowerShell 现场把它拼到桌面目录下——就算登记表被手工改坏也删不到别处。
 *
 * 登记表落在 <登录空间根>/_icons/shortcuts.json，按号 id 存，
 * 这样改名后再建会先删掉旧名字的快捷方式，不在桌面上留垃圾。
 */
const run = promisify(execFile);

const PREFIX = "工作台-";
const FILE_RE = /^工作台-[^\\/:*?"<>|\r\n]+\.lnk$/;

/** 桌面路径由 PowerShell 现算（GetFolderPath 才是权威，不同人可能被重定向过），结果用 base64 回传避开控制台编码 */
const CREATE_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  "try{",
  "$lnk=Join-Path ([Environment]::GetFolderPath('Desktop')) ($env:WB_NAME+'.lnk');",
  "$ws=New-Object -ComObject WScript.Shell;",
  "$s=$ws.CreateShortcut($lnk);",
  "$s.TargetPath=$env:WB_TARGET;",
  "$s.Arguments=$env:WB_ARGS;",
  "$s.IconLocation=$env:WB_ICON;",
  "$s.WorkingDirectory=$env:WB_WORK;",
  "$s.Description=$env:WB_DESC;",
  "$s.WindowStyle=7;",
  "$s.Save();",
  "Add-Type -Namespace Win -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int eventId,int flags,System.IntPtr item1,System.IntPtr item2);';",
  "[Win.Native]::SHChangeNotify(0x08000000,0,[System.IntPtr]::Zero,[System.IntPtr]::Zero);",
  "$okv=[string](Test-Path -LiteralPath $lnk);",
  "Write-Output ('OUT='+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($lnk)));",
  "Write-Output ('CREATED='+$okv);",
  "}catch{",
  "$em=[string]$_.Exception.Message;",
  "Write-Output ('ERR='+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($em)));",
  "}",
].join(" ");

const REMOVE_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  "try{",
  "$lnk=Join-Path ([Environment]::GetFolderPath('Desktop')) $env:WB_FILE;",
  "if(Test-Path -LiteralPath $lnk){Remove-Item -LiteralPath $lnk -Force};",
  "Add-Type -Namespace Win -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int eventId,int flags,System.IntPtr item1,System.IntPtr item2);';",
  "[Win.Native]::SHChangeNotify(0x08000000,0,[System.IntPtr]::Zero,[System.IntPtr]::Zero);",
  "Write-Output ('GONE='+[string]((Test-Path -LiteralPath $lnk) -eq $false));",
  "}catch{",
  "$em2=[string]$_.Exception.Message;",
  "Write-Output ('ERR='+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($em2)));",
  "}",
].join(" ");

type Entry = { fileName: string; iconPath: string; lnkPath: string; displayName: string; at: string };
type Reg = Record<string, Entry>;

const iconDir = () => join(profileRoot(), "_icons");
const regPath = () => join(iconDir(), "shortcuts.json");

function readReg(): Reg {
  try {
    const o = JSON.parse(readFileSync(regPath(), "utf8"));
    return o && typeof o === "object" ? (o as Reg) : {};
  } catch {
    return {};
  }
}

function writeReg(reg: Reg) {
  mkdirSync(iconDir(), { recursive: true });
  writeFileSync(regPath(), JSON.stringify(reg, null, 2), "utf8");
}

const fromB64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

/** 从 PowerShell 的 OUT=/ERR= 单行里取结果，不走控制台编码所以中文不会糊 */
function parseOut(stdout: string, tag: string): { value?: string; error?: string } {
  const out = /OUT=(\S+)/.exec(stdout);
  const err = /ERR=(\S+)/.exec(stdout);
  const gone = /GONE=(\S+)/.exec(stdout);
  if (err) return { error: fromB64(err[1]) };
  if (tag === "OUT" && out) return { value: fromB64(out[1]) };
  if (tag === "GONE" && gone) return { value: gone[1] };
  return { error: `启动器没有回话（stdout=${stdout.slice(0, 160)}）` };
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const id = Number(rawId);

  const account = await prisma.connectionAccount.findUnique({
    where: { id },
    include: { connection: true },
  });
  if (!account) return NextResponse.json({ error: "未找到" }, { status: 404 });
  if (!account.launchCommand.trim()) {
    return NextResponse.json({ error: "这个号还没有启动命令，建了快捷方式也点不动" }, { status: 400 });
  }

  const color = accountColor(id, account.label);
  const displayName = `${PREFIX}${shortcutName(account.connection.toolName, account.label)}`;
  const fileName = `${displayName}.lnk`;

  let iconPath: string;
  try {
    mkdirSync(iconDir(), { recursive: true });
    iconPath = join(iconDir(), `acc-${id}.ico`);
    writeFileSync(iconPath, buildAccountIco(color.hex));
  } catch (e) {
    return NextResponse.json({ error: `图标写不下去：${String(e)}` }, { status: 500 });
  }

  const reg = readReg();
  // 改过名的号：旧名字的快捷方式先清掉，不然桌面越攒越多对不上
  const prev = reg[String(id)];
  if (prev && prev.fileName && prev.fileName !== fileName && FILE_RE.test(prev.fileName)) {
    try {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", REMOVE_SCRIPT], {
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, WB_FILE: prev.fileName },
      });
    } catch {
      /* 旧的没删掉不影响新的建起来，如实记一笔就行 */
    }
  }

  const scriptPath = join(process.cwd(), "scripts", "shortcut-launch.mjs");
  try {
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", CREATE_SCRIPT],
      {
        windowsHide: true,
        timeout: 30000,
        env: {
          ...process.env,
          WB_NAME: displayName,
          WB_TARGET: process.execPath,
          WB_ARGS: `"${scriptPath}" a${id}`,
          WB_ICON: iconPath,
          WB_WORK: process.cwd(),
          WB_DESC: `${account.connection.toolName} · ${account.label}（${color.name}）`,
        }
      }
    );
    const r = parseOut(stdout, "OUT");
    if (r.error) return NextResponse.json({ error: `快捷方式没建起来：${r.error}` }, { status: 500 });
    // 路径单独用 base64 回传，标志位单独一行：号名里带空格也不会把路径切断
    const lnkPath = r.value ?? "";
    const created = /CREATED=True/i.test(stdout);
    if (!created) {
      return NextResponse.json({ error: `说建好了但桌面找不到 ${displayName}.lnk，可能被安全策略挡了` }, { status: 500 });
    }

    reg[String(id)] = {
      fileName,
      iconPath,
      lnkPath,
      displayName,
      at: new Date().toISOString(),
    };
    writeReg(reg);

    // 只记一条审计，不涉多表写入，所以直接把 prisma 当事务句柄传进去
    await logEvent(prisma, "connection_account", id, "shortcut", null, {
      displayName,
      color: color.hex,
      lnkPath,
    });
    return NextResponse.json({ ok: true, displayName, lnkPath, iconPath, color });
  } catch (e) {
    return NextResponse.json({ error: `快捷方式没建起来：${String(e)}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const id = Number(rawId);

  const reg = readReg();
  const entry = reg[String(id)];
  if (!entry) return NextResponse.json({ ok: true, removed: false, note: "桌面上本来就没有这个号的快捷方式" });
  if (!FILE_RE.test(String(entry.fileName ?? ""))) {
    return NextResponse.json({ error: "登记表里的文件名不合规矩，我没敢删，请手动清理", fileName: entry.fileName }, { status: 500 });
  }

  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", REMOVE_SCRIPT], {
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, WB_FILE: entry.fileName },
    });
    const r = parseOut(stdout, "GONE");
    if (r.error) return NextResponse.json({ error: `快捷方式没删掉：${r.error}` }, { status: 500 });
    if (!/^true$/i.test(r.value ?? "")) {
      return NextResponse.json({ error: `说要删但桌面上还在 ${entry.fileName}` }, { status: 500 });
    }
    if (entry.iconPath && existsSync(entry.iconPath)) {
      try {
        writeFileSync(entry.iconPath, Buffer.alloc(0)); // 先清内容再删，被占用时也不留残缺图标
        rmSync(entry.iconPath, { force: true });
      } catch {
        /* 图标残留只是个无用文件，不拦撤销 */
      }
    }
    delete reg[String(id)];
    writeReg(reg);
    await logEvent(prisma, "connection_account", id, "delete", null, {
      kind: "shortcut",
      fileName: entry.fileName,
    });
    return NextResponse.json({ ok: true, removed: true, fileName: entry.fileName });
  } catch (e) {
    return NextResponse.json({ error: `快捷方式没删掉：${String(e)}` }, { status: 500 });
  }
}
