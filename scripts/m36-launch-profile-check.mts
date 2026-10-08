/**
 * M36 哨兵：账号登录空间命令生成器的纯函数断言。
 * 全程不触库、不起浏览器、不碰真实磁盘——文件系统用注入的假 existsSync，
 * 路径全部是字符串 fixture。成功打印 M36_PASS，任一断言失败 exit(1)。
 */
import {
  buildAccountLaunch,
  defaultLoginMode,
  detectLoginMode,
  extractProfileDir,
  findBrowserExe,
  isUnderRoot,
  parseExe,
  profileRoot,
  sanitizeName,
  type FsProbe,
} from "../src/lib/launch-profile";
import { PALETTE, accountColor, safeFilePart, shortcutName } from "../src/lib/account-color";
import { buildAccountIco, crc32, encodePng, parseHex, renderBadge } from "../src/lib/account-icon";
import { inflateSync } from "node:zlib";

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
// 这些 fixture 测的是隔离分支，所以显式写 mode：M36.3 之后不传 mode 的默认值已是 reuse
const traeCard = { toolName: "TraeWork", launchCommand: `"${TRAE_EXE}"`, entryUrl: "https://trae.cn" };
const fsTrae = fakeFs([TRAE_EXE]);
const d1 = buildAccountLaunch({ card: traeCard, label: "号4", mode: "isolated", root: "E:/AI工具Profile" }, fsTrae);
ok(d1.ok === true, "桌面卡生成成功");
if (d1.ok) {
  eq(d1.kind, "desktop", "已配好本地程序的卡优先走桌面分支（即使有网址）");
  eq(d1.cmd, `"${TRAE_EXE}" --user-data-dir="E:/AI工具Profile/TraeWork-号4"`, "命令=原 exe 加独立用户目录");
  eq(split(d1.cmd).length, 2, "拆出来只有程序与参数两段");
}
const d2 = buildAccountLaunch({ card: traeCard, label: "号5", mode: "isolated", root: "E:/AI工具Profile" }, fsTrae);
ok(d1.ok && d2.ok && d1.profileDir !== d2.profileDir, "同卡不同号落到不同目录");
const d3 = buildAccountLaunch({ card: traeCard, label: "号4", mode: "isolated", root: "E:/AI工具Profile" }, fsTrae);
ok(d1.ok && d3.ok && d1.cmd === d3.cmd, "同卡同号重复生成命令一致（幂等）");

console.log("\n[6] 网页平台分支");
const ghCard = { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" };
const b1 = buildAccountLaunch({ card: ghCard, label: "小号", mode: "isolated", root: "R", browserExe: EDGE }, fakeFs([EDGE]));
ok(b1.ok === true, "网页卡生成成功");
if (b1.ok) {
  eq(b1.kind, "browser", "没有本地程序走浏览器分支");
  eq(b1.cmd, `"${EDGE}" --user-data-dir="R/GitHub-小号" --no-first-run --no-default-browser-check "https://github.com"`,
    "浏览器 + 独立目录 + 入口网址");
  ok(b1.note.includes("第一次"), "网页分支的说明里交代了首次要手动登录一次");
}
const b2 = buildAccountLaunch({ card: ghCard, label: "小号", mode: "isolated", root: "R", browserExe: null }, fakeFs([]));
ok(b2.ok === false && b2.reason.includes("没探测到"), "本机没浏览器时如实拒绝");

console.log("\n[7] 该拒的都拒掉");
const r1 = buildAccountLaunch({ card: ghCard, label: '" "', root: "R", browserExe: EDGE }, fakeFs([EDGE]));
ok(r1.ok === false && r1.reason.includes("清洗后为空"), "号名清洗后为空 → 拒");
const r2 = buildAccountLaunch({ card: traeCard, label: "号2", existingLabels: ["号 2"], mode: "isolated", root: "R" }, fsTrae);
ok(r2.ok === false && r2.reason.includes("共用同一份登录空间"), "与已有号清洗后同名 → 拒（否则会共用登录空间）");
const r3 = buildAccountLaunch({ card: { toolName: "X", launchCommand: '"E:/没了/exe.exe"', entryUrl: "" }, label: "号1", root: "R" }, fakeFs([]));
ok(r3.ok === false && r3.reason.includes("找不到"), "卡片里的程序路径已不存在 → 拒并带出该路径");
const r4 = buildAccountLaunch({ card: { toolName: "SkillHub", launchCommand: "", entryUrl: "" }, label: "号1", root: "R" }, fakeFs([]));
ok(r4.ok === false && r4.reason.includes("既没有"), "既无程序又无网址 → 拒");
const r5 = buildAccountLaunch({ card: { toolName: "X", launchCommand: "", entryUrl: "见主页导航" }, label: "号1", root: "R", browserExe: EDGE }, fakeFs([EDGE]));
ok(r5.ok === false, "入口网址不是 http(s) → 不硬拼命令");

console.log("\n[8] 注入防线：号名再怎么写也塞不进新命令");
const evil = 'x"; calc.exe #';
const e1 = buildAccountLaunch({ card: traeCard, label: evil, mode: "isolated", root: "E:/AI工具Profile" }, fsTrae);
ok(e1.ok === true, "恶意号名被清洗后仍能生成一条正常命令");
if (e1.ok) {
  eq(sanitizeName(evil), "xcalcexe", "清洗只留下中文/字母/数字/-_，引号分号井号全没");
  eq(split(e1.cmd).length, 2, "token 数与老实号名完全一致，没被拆出第二段命令");
  eq(split(e1.cmd)[0], TRAE_EXE, "第一段仍是被允许的那个 exe，不会被号名顶掉");
  eq(e1.profileDir, "E:/AI工具Profile/TraeWork-xcalcexe", "目录名里只有清洗过的安全字符");
}

console.log("\n[9] 真实卡片三形态回归（库里的样子固化成 fixture）");
const realTrae = { toolName: "TRAE SOLO CN（TRAE SOLO）", launchCommand: `"E:/AI工具/TRAE/TRAE SOLO.exe" --foo`, entryUrl: "https://www.trae.cn" };
const okTrae = buildAccountLaunch({ card: realTrae, label: "号2", mode: "isolated", root: "E:/AI工具Profile" }, fakeFs(["E:/AI工具/TRAE/TRAE SOLO.exe"]));
ok(okTrae.ok === true && okTrae.kind === "desktop", "桌面卡：沿用 exe 并追加独立目录");
const realKimi = { toolName: "Kimi", launchCommand: "", entryUrl: "https://kimi.moonshot.cn" };
const okKimi = buildAccountLaunch({ card: realKimi, label: "号3", mode: "isolated", root: "E:/AI工具Profile", browserExe: EDGE }, fakeFs([EDGE]));
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

/* ============ [11] 颜色门牌（M36.2）：不得依赖时间与运行环境 ============ */
const c7a = accountColor(7, "隔离演示");
const c7b = accountColor(7, "隔离演示");
eq(c7a.hex, c7b.hex, "同一个号反复算必须得同一个色（色一变就没了门牌意义）");
eq(c7a.index, c7b.index, "索引也要一致");
ok(c7a.index >= 0 && c7a.index < PALETTE.length, "索引落在调色板范围内");
ok(PALETTE.every((p) => /^#[0-9A-Fa-f]{6}$/.test(p.hex) && p.name.length > 0), "每个色都得有成对的 hex 与中文名");
ok(PALETTE.length >= 8, "调色板至少 8 色（单人十几号的量要够用）");
ok(new Set(Array.from({ length: 60 }, (_, i) => accountColor(i + 1, "主号").index)).size >= 6,
  "60 个同名不同 id 的号至少散到 6 种色（只用 label 会全撞一起）");
ok(new Set(Array.from({ length: 30 }, (_, i) => accountColor(9, `号${i}`).index)).size >= 6,
  "同 id 不同名也得散开（改名后换色是有意的）");
eq(accountColor(Number.NaN, "").index, accountColor(0, "").index, "坏 id 不报错，回落到 id=0");
ok(accountColor(1, null as unknown as string).hex.startsWith("#"), "空号名不能把函数弄崩");

/* 号名是用户随手打的，当文件名之前必须过这道 */
eq(safeFilePart('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j", "Windows 非法字符逐个换成下划线");
eq(safeFilePart("  工作号  "), "工作号", "首尾空白要去掉（NTFS 会静默吞，导致建了看不见）");
eq(safeFilePart("工作号..."), "工作号", "尾部的点也要去掉");
eq(safeFilePart(""), "未命名号", "空名给可读兜底而不是生成一个怪文件");
eq(safeFilePart("x".repeat(80)).length, 40, "超长要截断（路径有 260 字面上限）");
eq(safeFilePart("a\u0007b").includes("\u0007"), false, "控制字符不能留在文件名里");
ok(shortcutName("TRAE", "号2").includes("号2"), "快捷方式名里要能看见号名");

/* ============ [12] 图标生成（M36.2）：手写 PNG/ICO 编码器 ============ */
/* CRC32 必须用外部权威常量验，只让自己的实现自证等于没验 */
eq(crc32(Buffer.from("123456789")), 0xcbf43926, "标准校验值 crc32('123456789')");
eq(crc32(Buffer.from("IEND", "ascii")), 0xae426082, "PNG 空 IEND 块的 CRC 恒为该值");

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const rgb = parseHex("#0EA5E9");
ok(rgb.r === 14 && rgb.g === 165 && rgb.b === 233, "hex 按 RRGGBB 拆开");
ok(parseHex("这不是颜色").r === 107, "坏 hex 回落到中性灰而不是抛异常");

const badge = renderBadge("#0EA5E9", 32);
eq(badge.length, 32 * 32 * 4, "32px 的 RGBA 字节数要对");
eq(badge[3], 0, "左上角在圆外，alpha 必须为 0（透明边）");
eq(badge[(31 * 32 + 31) * 4 + 3], 0, "右下角同样透明");
const mid = (16 * 32 + 16) * 4;
ok(badge[mid + 3] === 255, "圆心完全不透明");
eq(badge[mid], 255, "圆心被白色中心点盖住");

/* 圆内、环外、点外那一圈应当就是号自己的颜色 */
const big = renderBadge("#0EA5E9", 64);
const bp = (6 * 64 + 32) * 4;
ok(big[bp] === 14 && big[bp + 1] === 165 && big[bp + 2] === 233 && big[bp + 3] === 255,
  "环外圆内的像素必须正是该号配色（颜色真画上去了）");

const png = encodePng(badge, 32);
ok(png.subarray(0, 8).equals(SIG), "PNG 签名对");
eq(png.readUInt32BE(16), 32, "IHDR 宽度");
eq(png.readUInt32BE(20), 32, "IHDR 高度");
eq(png[25], 6, "IHDR 颜色类型必须为 6（RGBA）");

function pngChunks(buf: Buffer) {
  const out: { type: string; data: Buffer; crc: number }[] = [];
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    out.push({ type, data: buf.subarray(o + 8, o + 8 + len), crc: buf.readUInt32BE(o + 8 + len) });
    o += 12 + len;
  }
  return out;
}
const chunks = pngChunks(png);
eq(chunks.map((c) => c.type).join(","), "IHDR,IDAT,IEND", "块顺序与数量");
ok(chunks.every((c) => c.crc === crc32(Buffer.concat([Buffer.from(c.type, "ascii"), c.data]))), "每块 CRC 与内容对得上");
const raw = inflateSync(chunks.find((c) => c.type === "IDAT")!.data);
eq(raw.length, 32 * (32 * 4 + 1), "解压回来 = 每行多一个 filter 字节");
ok(raw.every((v: number, i: number) => i % (32 * 4 + 1) !== 0 || v === 0), "每行 filter 全为 0（None）");
ok(raw.subarray(1, 5).equals(badge.subarray(0, 4)), "第一行第一个像素在压缩往返后字节不变");

const ico = buildAccountIco("#0EA5E9");
eq(ico.readUInt16LE(2), 1, "ICO 类型为 icon");
eq(ico.readUInt16LE(4), 2, "两个尺寸档位");
eq(ico[6], 32, "第一档宽高照写");
eq(ico[22], 0, "256 档在目录项里要写 0（规范如此，不是漏写）");
const len0 = ico.readUInt32LE(14);
const off0 = ico.readUInt32LE(18);
const len1 = ico.readUInt32LE(30);
const off1 = ico.readUInt32LE(34);
eq(off0, 38, "数据从两个目录项之后开始");
eq(off1, off0 + len0, "第二档紧接第一档，无空洞无重叠");
eq(ico.length, off1 + len1, "总长与目录自洽");
ok(ico.subarray(off0, off0 + 8).equals(SIG), "32 档条目是真 PNG");
ok(ico.subarray(off1, off1 + 8).equals(SIG), "256 档条目是真 PNG");
ok(!buildAccountIco("#E11D48").equals(ico), "换个颜色就得是不同图标");
eq(buildAccountIco("#0EA5E9").length, ico.length, "同色两次生成结果一致（可安全重复写盘）");

console.log("\n[13] 登录态来源模式：单号复用本机、多号才隔离（M36.3）");
// 现实依据：34 张卡里只有 1 张有多个号，本机浏览器早就登着，每号都隔离等于逼人多登一次
eq(defaultLoginMode(0), "reuse", "卡上第一个号默认复用本机现成登录态");
eq(defaultLoginMode(1), "isolated", "第二个号起必须隔离，否则两个号是同一个身份");
eq(defaultLoginMode(9), "isolated", "再多也一律隔离");

eq(detectLoginMode(`"${EDGE}" --user-data-dir="E:/AI工具Profile/GitHub-号1" "https://github.com"`), "isolated", "带独立目录的命令判为隔离");
eq(detectLoginMode(`"${EDGE}" "https://github.com"`), "reuse", "不带独立目录就是复用本机");
eq(detectLoginMode(""), "reuse", "空命令也没分过目录，算复用");
eq(detectLoginMode(`"${EDGE}" -user-data-dir=E:/x`), "reuse", "少一个横杠的参数不算隔离（精确匹配 --user-data-dir）");

// 网页卡复用模式：只调本机浏览器开网址，绝不带 --user-data-dir
const rWeb = buildAccountLaunch(
  { card: { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com/notifications" }, label: "我的号", existingLabels: [], mode: "reuse", browserExe: EDGE },
  fakeFs([EDGE])
);
ok(rWeb.ok === true, "网页卡复用模式能生成命令");
if (rWeb.ok) {
  eq(rWeb.mode, "reuse", "结果里如实标出模式");
  eq(rWeb.profileDir, "", "复用模式不分登录空间目录");
  ok(!/--user-data-dir/i.test(rWeb.cmd), "复用命令里没有 --user-data-dir（这就是不重登的关键）");
  eq(split(rWeb.cmd)[0], EDGE, "第一段是本机浏览器");
  eq(split(rWeb.cmd)[split(rWeb.cmd).length - 1], "https://github.com/notifications", "最后一段原样是入口网址");
  ok(/本机/.test(rWeb.note), "复用模式的说明要讲清登录态来自本机");
  ok(!/第一次.*登录/.test(rWeb.note), "复用模式的说明不该出现「第一次要自己登录」那种隔离模式的话");
}

// 桌面工具复用模式：卡片自己的命令一个字不改地搬过来，附带参数不能丢
const rDesk = buildAccountLaunch(
  { card: { toolName: "TraeWork CN（TRAE SOLO）", launchCommand: `"${TRAE_EXE}" --keep-flag`, entryUrl: "https://trae.cn" }, label: "主号", existingLabels: [], mode: "reuse", browserExe: EDGE },
  fakeFs([TRAE_EXE, EDGE])
);
ok(rDesk.ok === true, "桌面卡复用模式能生成命令");
if (rDesk.ok) {
  eq(rDesk.kind, "desktop", "优先仍按桌面工具分派（exe 存在）");
  eq(rDesk.cmd, `"${TRAE_EXE}" --keep-flag`, "命令就是卡片原命令，程序参数不丢");
  eq(rDesk.profileDir, "", "桌面复用也不分目录");
}

// 隔离模式仍按老规则出命令，且显式模式能压过默认推断
const rIso = buildAccountLaunch(
  { card: { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" }, label: "号2", existingLabels: [], mode: "isolated", browserExe: EDGE },
  fakeFs([EDGE])
);
ok(rIso.ok === true, "显式要隔离时，第一个号也能建独立空间");
if (rIso.ok) {
  eq(rIso.mode, "isolated", "显式模式不被默认规则覆盖");
  ok(/--user-data-dir="/i.test(rIso.cmd), "隔离命令照旧带独立目录");
  ok(/第一次/.test(rIso.note), "隔离模式的说明保留「首登一次」的预告");
}

// 没传 mode 时按已有号数推断，这样调用方少写一行也不会做错
const rAuto = buildAccountLaunch(
  { card: { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" }, label: "号2", existingLabels: ["我的号"], browserExe: EDGE },
  fakeFs([EDGE])
);
ok(rAuto.ok === true && rAuto.mode === "isolated", "不传 mode：卡上已有一个号就自动隔离");
const rAuto0 = buildAccountLaunch(
  { card: { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" }, label: "我的号", existingLabels: [], browserExe: EDGE },
  fakeFs([EDGE])
);
ok(rAuto0.ok === true && rAuto0.mode === "reuse", "不传 mode：卡上没号就自动复用");

// 复用模式也躲不开的两条失败：没浏览器、没网址
const rNoBr = buildAccountLaunch(
  { card: { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" }, label: "我的号", mode: "reuse", browserExe: null },
  fakeFs([])
);
ok(!rNoBr.ok && /Edge|Chrome/.test(rNoBr.reason ?? ""), "复用模式没本机浏览器同样如实失败");
const rNoUrl = buildAccountLaunch(
  { card: { toolName: "某桌面工具", launchCommand: "", entryUrl: "" }, label: "我的号", mode: "reuse", browserExe: EDGE },
  fakeFs([EDGE])
);
ok(!rNoUrl.ok, "既没本地程序也没网址时，复用模式也不硬拼命令");

// 清洗后重名的护栏在两种模式下都要成立
const rClash = buildAccountLaunch(
  { card: { toolName: "GitHub", launchCommand: "", entryUrl: "https://github.com" }, label: "号 2", existingLabels: ["号2"], mode: "reuse", browserExe: EDGE },
  fakeFs([EDGE])
);
ok(!rClash.ok && /共用|同一个/.test(rClash.reason ?? ""), "复用模式也挡住清洗后同名的双胞胎号");

if (failed > 0) {
  console.log(`\nM36_CHECK_FAILED: ${failed} 条断言未过`);
  process.exit(1);
}
console.log("M36_PASS");
