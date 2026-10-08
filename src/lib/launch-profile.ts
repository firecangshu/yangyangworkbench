/**
 * 账号登录空间生成器（M36）。
 *
 * 要做的事：让「一个平台存多个号、点一下就切过去」成立，而且不碰密码。
 * 原理（本机实测确认，非推测）：登录态就是浏览器/Electron 存在「用户数据目录」里的
 * localStorage 与 cookie。给每个号一个独立 --user-data-dir，它就拥有独立的一份登录态；
 * 实测结果：A 目录首启 WAS=NULL、二启 WAS=TOKENA（登录态保住了）、B 目录始终看不到 A 的标记。
 *
 * 为什么必须服务端生成命令：现有 34 张卡里 33 张没配账号，原因是加号要手填
 * `"exe" --user-data-dir="..."` 这种命令行，网页平台的人根本写不出来。
 * 同时命令文本会经 .launch-queue → execFile 执行，绝不能让自由文本从前端流进来。
 */

import { existsSync } from "fs";

/** 账号生成器用到的文件系统探针，注入以便哨兵离线断言 */
export type FsProbe = { existsSync: (p: string) => boolean };
const realFs: FsProbe = { existsSync: (p) => existsSync(p) };

const PROFILE_ROOT_ON_E = "E:/AI工具Profile";

/** 本机浏览器候选（实测：这台机器只有 Edge，无 Chrome） */
const BROWSER_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

/**
 * 登录空间根目录：优先环境变量 WORKBENCH_PROFILE_ROOT，其次沿用你已有的 E:/AI工具Profile
 * （TRAE 的号2/号3 就在那儿），E 盘不在（换机器/没插盘）就退到用户目录下。
 * 为什么要能调：E 盘若是同步盘或可拔插移动盘，登录态就等于被同步到别处，
 * 得能把整个根目录改到本地固定盘。
 */
export function profileRoot(fs: FsProbe = realFs, env: NodeJS.ProcessEnv = process.env): string {
  const byEnv = String(env.WORKBENCH_PROFILE_ROOT ?? "").trim();
  if (byEnv) return byEnv.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  if (fs.existsSync("E:/")) return PROFILE_ROOT_ON_E;
  const base = env.LOCALAPPDATA || env.HOME || ".";
  return `${base.replace(/\\/g, "/")}/AI工具Profile`;
}

/** Windows 路径比较专用：统一分隔符并转小写 */
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/**
 * 目录是否真的落在登录空间根下（M36.1 关键护栏）。
 * 只有我们自己分出去的目录才允许被打开/被删；否则一个脏命令就能把
 * “清理号目录”变成“删掉用户盘上任意目录”。
 */
export function isUnderRoot(dir: string, root: string): boolean {
  const d = norm(dir), r = norm(root);
  if (!d || !r) return false;
  if (r.split("/").filter(Boolean).length < 2) return false; // 根至少是“盘/目录”，不承认盘根
  return d === r || d.startsWith(`${r}/`);
}

/**
 * 从启动命令里反解出 --user-data-dir 的值；没带这个参数（手写命令、卡片默认命令）返回 null。
 * 靠它定位登录空间，不用给表加字段。
 */
export function extractProfileDir(cmd: string): string | null {
  const s = String(cmd ?? "");
  const quoted = s.match(/--user-data-dir="([^"]+)"/i);
  if (quoted) return quoted[1];
  const bare = s.match(/--user-data-dir=([^\s"]+)/i);
  return bare ? bare[1] : null;
}

/** 号名清洗：目录名与命令文本都用它，只留中文/字母/数字/-_ */
export function sanitizeName(raw: string): string {
  return String(raw ?? "")
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9_-]/g, "")
    .slice(0, 24);
}

/** 从卡片默认启动命令里抠出 exe 路径（支持首 token 带引号，与启动器 splitCommandLine 同一套引号语义） */
export function parseExe(cmd: string): string | null {
  const s = String(cmd ?? "").trim();
  if (!s) return null;
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    // 引号没闭合就是残缺命令，宁可不认，也不要拼出一条会误启动的串
    return end > 1 ? s.slice(1, end) : null;
  }
  return s.split(/\s+/)[0] ?? null;
}

export function findBrowserExe(fs: FsProbe = realFs): string | null {
  return BROWSER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

export type AccountCard = {
  toolName: string;
  /** 卡片自己的默认启动命令（桌面工具通常是 exe 绝对路径） */
  launchCommand: string;
  entryUrl: string;
};

export type BuildInput = {
  card: AccountCard;
  /** 用户输入的号名，如「号2」「工作号」 */
  label: string;
  /** 同卡内已有号名，用来挡「清洗后同名会共用登录空间」 */
  existingLabels?: string[];
  browserExe?: string | null;
  root?: string;
};

export type BuildResult =
  | { ok: true; kind: "desktop" | "browser"; cmd: string; profileDir: string; note: string }
  | { ok: false; reason: string };

/**
 * 生成一个号的启动命令。三条分派，判不出来就如实说不行，绝不拼一条没把握的命令：
 *   桌面工具 → 沿用它的 exe，追加 --user-data-dir
 *   网页平台 → 本机浏览器 + --user-data-dir + 入口网址
 *   两者都不成立 → ok=false 带原因（例如既没配 exe 也没网址）
 */
export function buildAccountLaunch(input: BuildInput, fs: FsProbe = realFs): BuildResult {
  const clean = sanitizeName(input.label);
  if (!clean) return { ok: false, reason: "号名清洗后为空，只能使用中文、字母、数字、- 和 _" };

  const clash = (input.existingLabels ?? []).map(sanitizeName).includes(clean);
  if (clash) return { ok: false, reason: `已有号名清洗后也叫「${clean}」，两个号会共用同一份登录空间，请换一个名` };

  const root = input.root ?? profileRoot(fs);
  const profileDir = `${root}/${sanitizeName(input.card.toolName)}-${clean}`;

  // ① 桌面工具：卡片自己的命令能解析出磁盘上存在的 exe
  const exe = parseExe(input.card.launchCommand);
  if (exe && fs.existsSync(exe)) {
    return {
      ok: true,
      kind: "desktop",
      cmd: `"${exe}" --user-data-dir="${profileDir}"`,
      profileDir,
      note: "桌面程序靠 Chromium/Electron 的 --user-data-dir 约定隔离数据目录；个别程序不认这个参数，切换后若仍是同一个登录态，就说明它不支持，只能靠程序自己的换号功能。",
    };
  }

  // ② 网页平台：有 http(s) 入口网址，交给本机浏览器开独立用户目录
  const url = String(input.card.entryUrl ?? "").trim();
  if (/^https?:\/\//i.test(url)) {
    const browser = input.browserExe === undefined ? findBrowserExe(fs) : input.browserExe;
    if (!browser) return { ok: false, reason: "本机没探测到 Edge 或 Chrome，网页类平台没法建独立登录空间" };
    return {
      ok: true,
      kind: "browser",
      cmd: `"${browser}" --user-data-dir="${profileDir}" --no-first-run --no-default-browser-check "${url}"`,
      profileDir,
      note: "这个号第一次要你自己登录一次，之后点它就是登录态；密码由浏览器存在这个独立目录里，工作台不读取也不保存。",
    };
  }

  return {
    ok: false,
    reason: exe
      ? `卡片里配的程序路径「${exe}」在磁盘上找不到，同时这张卡也没有入口网址，没法建登录空间`
      : "这张卡既没有本地程序启动命令、也没有 http(s) 入口网址，没法建独立登录空间",
  };
}
