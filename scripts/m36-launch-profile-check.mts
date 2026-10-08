/**
 * M36 哨兵：账号登录空间命令生成器的纯函数断言。
 * 全程不触库、不起浏览器、不碰真实磁盘——文件系统用注入的假 existsSync，
 * 路径全部是字符串 fixture。成功打印 M36_PASS，任一断言失败 exit(1)。
 */
import {
  buildAccountLaunch,
  extractProfileDir,
  findBrowserExe,
  isUnderRoot,
  parseExe,
  profileRoot,
  sanitizeName,
  type FsProbe,
} from "../src/lib/launch-profile";

let failed = 0;
function ok(cond: boolean, msg: string) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failed++;
}
function eq(actual: unknown, expect: unknown, msg: string) {
  ok(actual === expect, `${msg}（实际 ${JSON.stringify(actual)}）`);
}

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TRAE_EXE = "E:/AI工具/TRAE/TRAE SOLO.exe";

/** 假文件系统：files 是存在的文件，hasE 决定 E 盘在不在 */
const fakeFs = (files: string[], hasE = true): FsProbe => ({
  existsSync: (p) => (hasE && p === "E:/") || files.includes(p),
});

/**
 * 与 scripts/launch-connection.mjs 的 splitCommandLine 同一套引号语义（改动须两边同步）：
 * 用它断言生成出来的命令不会因用户输入被拆出多余 token。
 */
function split(cmd: string): string[] {
  const tokens: string[] = [];
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

console.log("\n[1] sanitizeName 号名清洗");
eq(sanitizeName("号2"), "号2", "中文加数字原样保留");
eq(sanitizeName("  工作 号-1 "), "工作号-1", "空格剔掉、中划线保留");
eq(sanitizeName('a"b|c;d'), "abcd", "引号竖线分号一律剔除");
eq(sanitizeName("../../evil"), "evil", "目录穿越符号被吃掉");
eq(sanitizeName("ab".repeat(30)).length, 24, "超长截断到 24 字符");
eq(sanitizeName('" "'), "", "只剩空白时清洗结果为空");

console.log("\n[2] parseExe 从卡片命令抠 exe");
eq(parseExe(`"${TRAE_EXE}" --foo`), TRAE_EXE, "首 token 带引号时按引号取整段");
eq(parseExe("E:/x.exe --foo"), "E:/x.exe", "不带引号取第一个空格前");
eq(parseExe('"E:/unclosed.exe'), null, "引号没闭合视为残缺命令");
eq(parseExe(""), null, "空命令返回 null");

console.log("\n[3] profileRoot 登录空间根目录");
eq(profileRoot(fakeFs([], true), {}), "E:/AI工具Profile", "有 E 盘沿用既有约定目录");
eq(profileRoot(fakeFs([], false), { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }),
  "C:/Users/u/AppData/Local/AI工具Profile", "没 E 盘退到 LOCALAPPDATA 且反斜杠转正");
eq(profileRoot(fakeFs([], false), {}), "./AI工具Profile", "两个都没有时退到相对目录不抛错");

console.log("\n[4] findBrowserExe 浏览器探测");
eq(findBrowserExe(fakeFs([EDGE])), EDGE, "探到 Edge");
eq(findBrowserExe(fakeFs([CHROME])), CHROME, "只有 Chrome 时用 Chrome");
eq(findBrowserExe(fakeFs([])), null, "都没有返回 null");

console.log("\n[5] 桌面工具分支");
const traeCard = { toolName: "TraeWork", launchCommand: `"${TRAE_EXE}"`, entryUrl: "https://trae.cn" };
const fsTrae = fakeFs([TRAE_EXE]);
const d1 = buildAccountLaunch({ card: traeCard, label: "号4", root: "E:/AI工具Profile" }, fsTrae);
ok(d1.ok === true, "桌面卡生成成功");
if (d1.ok) {
  eq(d1.kind, "desktop", "已配好本地程序的卡优先走桌面分支（即使有网址）");
  eq(d1.cmd, `"${TRAE_EXE}" --user-data-dir="E:/AI工具Profile/TraeWork-号4"`, "命令=原 exe 加独立用户目录");
  eq(split(d1.cmd).length, 2, "拆出来只有程序与参数两段");
}
const d2 = buildAccountLaunch({ card: traeCard, label: "号5", root: "E:/AI工具Profile" }, fsTrae);
ok(d1.ok && d2.ok && d1.profileDir !== d2.profileDir, "同卡不同号落到不同目录");
const d3 = buildAccountLaunch({ card: traeCard, label: "号4", root: "E:/AI工具Profile" }, fsTrae);
ok(d1.ok && d3.ok && d1.cmd === d3.cmd, "同卡同号重复生成命令一致（幂等）");

console.log("\n[6] 网页平台分支");
const ghCard = { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" };
const b1 = buildAccountLaunch({ card: ghCard, label: "小号", root: "R", browserExe: EDGE }, fakeFs([EDGE]));
ok(b1.ok === true, "网页卡生成成功");
if (b1.ok) {
  eq(b1.kind, "browser", "没有本地程序走浏览器分支");
  eq(b1.cmd, `"${EDGE}" --user-data-dir="R/GitHub-小号" --no-first-run --no-default-browser-check "https://github.com"`,
    "浏览器 + 独立目录 + 入口网址");
  ok(b1.note.includes("第一次"), "网页分支的说明里交代了首次要手动登录一次");
}
const b2 = buildAccountLaunch({ card: ghCard, label: "小号", root: "R", browserExe: null }, fakeFs([]));
ok(b2.ok === false && b2.reason.includes("没探测到"), "本机没浏览器时如实拒绝");

console.log("\n[7] 该拒的都拒掉");
const r1 = buildAccountLaunch({ card: ghCard, label: '" "', root: "R", browserExe: EDGE }, fakeFs([EDGE]));
ok(r1.ok === false && r1.reason.includes("清洗后为空"), "号名清洗后为空 → 拒");
const r2 = buildAccountLaunch({ card: traeCard, label: "号2", existingLabels: ["号 2"], root: "R" }, fsTrae);
ok(r2.ok === false && r2.reason.includes("共用同一份登录空间"), "与已有号清洗后同名 → 拒（否则会共用登录空间）");
const r3 = buildAccountLaunch({ card: { toolName: "X", launchCommand: '"E:/没了/exe.exe"', entryUrl: "" }, label: "号1", root: "R" }, fakeFs([]));
ok(r3.ok === false && r3.reason.includes("找不到"), "卡片里的程序路径已不存在 → 拒并带出该路径");
const r4 = buildAccountLaunch({ card: { toolName: "SkillHub", launchCommand: "", entryUrl: "" }, label: "号1", root: "R" }, fakeFs([]));
ok(r4.ok === false && r4.reason.includes("既没有"), "既无程序又无网址 → 拒");
const r5 = buildAccountLaunch({ card: { toolName: "X", launchCommand: "", entryUrl: "见主页导航" }, label: "号1", root: "R", browserExe: EDGE }, fakeFs([EDGE]));
ok(r5.ok === false, "入口网址不是 http(s) → 不硬拼命令");

console.log("\n[8] 注入防线：号名再怎么写也塞不进新命令");
const evil = 'x"; calc.exe #';
const e1 = buildAccountLaunch({ card: traeCard, label: evil, root: "E:/AI工具Profile" }, fsTrae);
ok(e1.ok === true, "恶意号名被清洗后仍能生成一条正常命令");
if (e1.ok) {
  eq(sanitizeName(evil), "xcalcexe", "清洗只留下中文/字母/数字/-_，引号分号井号全没");
  eq(split(e1.cmd).length, 2, "token 数与老实号名完全一致，没被拆出第二段命令");
  eq(split(e1.cmd)[0], TRAE_EXE, "第一段仍是被允许的那个 exe，不会被号名顶掉");
  eq(e1.profileDir, "E:/AI工具Profile/TraeWork-xcalcexe", "目录名里只有清洗过的安全字符");
}

console.log("\n[9] 真实卡片三形态回归（库里的样子固化成 fixture）");
const realTrae = { toolName: "TRAE SOLO CN（TRAE SOLO）", launchCommand: `"E:/AI工具/TRAE/TRAE SOLO.exe" --foo`, entryUrl: "https://www.trae.cn" };
const okTrae = buildAccountLaunch({ card: realTrae, label: "号2", root: "E:/AI工具Profile" }, fakeFs(["E:/AI工具/TRAE/TRAE SOLO.exe"]));
ok(okTrae.ok === true && okTrae.kind === "desktop", "桌面卡：沿用 exe 并追加独立目录");
const realKimi = { toolName: "Kimi", launchCommand: "", entryUrl: "https://kimi.moonshot.cn" };
const okKimi = buildAccountLaunch({ card: realKimi, label: "号3", root: "E:/AI工具Profile", browserExe: EDGE }, fakeFs([EDGE]));
ok(okKimi.ok === true && okKimi.kind === "browser" && okKimi.profileDir === "E:/AI工具Profile/Kimi-号3", "网页卡：Edge 独立目录 + 入口网址");
const realHub = { toolName: "SkillHub", launchCommand: "", entryUrl: "" };
ok(buildAccountLaunch({ card: realHub, label: "号1", root: "R", browserExe: EDGE }, fakeFs([EDGE])).ok === false, "小程序类：没命令没网址如实不可用");

console.log("\n[10] M36.1：登录空间目录反解 + 误删护栏 + 根目录可配置");
ok(extractProfileDir('"a.exe" --user-data-dir="E:/x/号1"') === "E:/x/号1", "双引号形式能反解");
ok(extractProfileDir("a.exe --user-data-dir=E:/x/y --flag") === "E:/x/y", "无引号形式能反解");
ok(extractProfileDir('"a.exe" "https://a.com"') === null, "手写命令没这个参数就返回 null");
ok(extractProfileDir("") === null, "空命令不抛异常");

// 误删护栏：只有我们自己分出去的目录才允许被操作
ok(isUnderRoot("E:/AI工具Profile/TraeWork-号4", "E:/AI工具Profile") === true, "正常子目录应认");
ok(isUnderRoot("E:\\AI工具Profile\\TraeWork-号4", "E:/AI工具Profile") === true, "反斜杠形式也应认");
ok(isUnderRoot("e:/ai工具profile/号1", "E:/AI工具Profile") === true, "Windows 路径大小写不敏感");
ok(isUnderRoot("C:/Users/User/Documents", "E:/AI工具Profile") === false, "盘外目录必须拒");
ok(isUnderRoot("E:/AI工具ProfileX/a", "E:/AI工具Profile") === false, "名字前缀重叠的兄弟目录不能误认");
ok(isUnderRoot("D:/", "D:/") === false, "拿盘根当根目录必须拒（否则等于允许删整盘）");
ok(isUnderRoot("", "E:/AI工具Profile") === false, "空目录一律拒");

// 根目录可配置
ok(profileRoot(fakeFs([EDGE]), { WORKBENCH_PROFILE_ROOT: "D:/我的登录空间" }) === "D:/我的登录空间", "环境变量优先于 E 盘约定");
ok(profileRoot(fakeFs([EDGE]), { WORKBENCH_PROFILE_ROOT: "D:/x/" }) === "D:/x", "尾部斜杠要抹掉");
ok(profileRoot(fakeFs([EDGE]), { WORKBENCH_PROFILE_ROOT: "D:\\x\\" }) === "D:/x", "反斜杠要统一成正斜杠");
ok(profileRoot(fakeFs([EDGE]), {}) === "E:/AI工具Profile", "没设环境变量时保持 E 盘优先");
// 号名里的相对路径成分先被清洗，洗不掉的才拼进目录
ok(sanitizeName("../../Windows/system32") === "Windowssystem32", "../ 这类成分应被清洗掉");
ok(isUnderRoot("E:/AI工具Profile/T-Windowssystem32", "E:/AI工具Profile") === true, "清洗后的名字仍落在根下");

if (failed > 0) {
  console.log(`\nM36_CHECK_FAILED: ${failed} 条断言未过`);
  process.exit(1);
}
console.log("M36_PASS");
