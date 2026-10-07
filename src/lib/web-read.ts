/**
 * 只读网页抓取（M35）。给助手补上「一双手」：读公开网页正文，喂给它已有的抽取管线。
 *
 * 三层降级，全部零新依赖（Node 22 内置 fetch / TextDecoder / AbortSignal.timeout）：
 *   L1 裸 fetch —— 静态站与 SSR 站又快又干净（实测 gov.cn 11176 可见字符 / 547ms）
 *   L2 Edge 无头 —— 仅当 L1 正文过短时才起，专治纯前端渲染的站
 *   L3 都不行 —— 如实返回失败，由模型照实说「请截图或粘贴正文」
 *
 * 实测过的边界（别自欺）：
 *   · Edge 过不了人机验证：kaggle 撞 reCAPTCHA，裸 fetch 与 Edge 都只拿到 64 可见字符
 *   · Edge 有站点直接超时失败：community.codewave.163.com 两种 profile 下均 0B / 40s
 *   · 裸 fetch 在静态站反而更好：aliyun 用 Edge 慢 6 倍、体积 5 倍、正文没变多
 *   所以 Edge 是「补 JS 渲染」的手段，不是「破反爬」的手段。
 */
import { execFile } from "child_process";
import { existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** 正文可见字符低于此值 → 判定为空壳/被拦，值得再试无头浏览器 */
export const EDGE_MIN_CHARS = 600;
/** 最终仍低于此值 → 认定没读到内容，ok=false */
export const MIN_OK_CHARS = 80;
/** 单次响应体积上限（防把内存吃掉） */
const MAX_BYTES = 300 * 1024;
/** 回给模型的正文上限（中文字符） */
const MAX_TEXT = 6000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};
const FETCH_MS = 15_000;
const EDGE_MS = 25_000;
const MAX_HOPS = 3;

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

export type ReadResult = {
  ok: boolean;
  url: string;
  title: string;
  text: string;
  chars: number;
  via: "fetch" | "edge" | "none";
  httpStatus: number;
  truncated: boolean;
  blocked?: string;
  hint: string;
};

/* ------------------------------------------------------------------ 地址与白名单 */

/** 抠出文本里出现过的 http(s) 网址，顺手剥掉粘连的中文标点后缀 */
export function collectUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(/https?:\/\/[^\s<>"'`）)，。；、！？]+/gi)) {
    let u = m[0];
    while (/[.,;:!?'"）)】\]]$/.test(u)) u = u.slice(0, -1);
    if (u.length > 12) out.add(u);
  }
  return [...out];
}

/** 归一化用于比对：校验协议、去 hash、去路径尾斜杠（用户贴的链接常带或不带）；非法返回 null */
function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    let href = u.href;
    if (u.pathname === "/") href = href.replace(/\/$/, "");
    return href;
  } catch {
    return null;
  }
}

/**
 * 双重把关：
 *   ① allowlist —— 网址必须要么出现在用户消息里，要么是本轮 search_web 刚返回的。模型会臆造 URL
 *      （用户只说「这个网址」它就编一个），这一层专治幻觉；工具输出不是臆造，所以下游能合法接住。
 *   ② SSRF —— 拒绝 IP 字面量与无点主机名。工作台跑在 localhost 且有本地库，
 *      不能让它成为访问内网的跳板。
 * 已知边界（如实说明，不假装防住）：域名解析到内网 IP（DNS rebinding）、以及
 * 127.0.0.1.nip.io 这类回环别名，这里拦不住——要彻底防需在 resolver 层校验，
 * 而 undici 不好插。本机单用户个人工具，接受这个残余风险。
 */
export function assertSafeUrl(raw: string, allow: string[]): { url: string | null; reason: string } {
  const n = normalizeUrl(raw);
  if (!n) return { url: null, reason: "只允许 http/https 网址" };

  let host = "";
  try {
    host = new URL(n).hostname;
  } catch {
    return { url: null, reason: "网址无法解析" };
  }
  // IP 字面量一律拒：十/八/十六进制变形、IPv6 全在射程内，而比赛官网永远是域名
  if (/^\[.*\]$/.test(host)) return { url: null, reason: "禁止 IP 字面量地址" };
  if (/^[\d.]+$/.test(host) || /^[0-9a-fA-Fx:]+$/.test(host)) return { url: null, reason: "禁止 IP 字面量地址" };
  if (!host.includes(".")) return { url: null, reason: "禁止访问无点主机名（本机/内网名）" };
  if (/(^|\.)(localhost|local|internal|intranet|localdomain|test|invalid)$/i.test(host))
    return { url: null, reason: "禁止访问内网保留域名" };

  const set = new Set(allow.map(normalizeUrl).filter((x): x is string => !!x));
  if (set.size === 0) return { url: null, reason: "用户消息里没有出现过任何网址，我也还没搜过，不能凭空猜一个去访问" };
  if (!set.has(n)) return { url: null, reason: "该网址既不在用户消息里、也不是本轮搜索返回的结果，为避免臆造链接不允许访问" };

  // 返回用户原样（仅 trim）的网址去请求：归一化只用于比对。
  // 拿削掉尾斜杠的地址去发请求会在 /x ↔ /x/ 之间 301 打转，三跳耗尽后拿到空正文（活体测试踩到）。
  return { url: String(raw).trim(), reason: "" };
}

/* ------------------------------------------------------------------ 正文抽取 */

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  mdash: "—", ndash: "–", hellip: "…", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  middot: "·", copy: "©", reg: "®", trade: "™", times: "×", rarr: "→", larr: "←", harr: "↔",
  bull: "•", deg: "°", emsp: " ", thinsp: " ", shy: "",
  yen: "¥", euro: "€", pound: "£", dollar: "$", sect: "§", para: "¶",
  ldquor: "“", rdquor: "”", quad: " ", ensp: " ", num: "#", percnt: "%", plusmn: "±", frac12: "½",
};

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d{1,6});/g, (_, d) => fromCode(Number(d)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,9});/g, (m, k) => ENTITIES[String(k).toLowerCase()] ?? m);
}

/** 换行的块级标签名单（不带 /g：下面要在 .test() 里反复用，全局正则的 lastIndex 会漏判） */
const BLOCKY_SRC = "<(?:/)?(?:p|div|section|article|li|ul|ol|tr|table|h[1-6]|br|header|footer|nav|main|aside|blockquote|pre|dt|dd)(?:\\s[^>]*)?>";
const BLOCKY = new RegExp(BLOCKY_SRC, "i");

/** 可见正文字符数：只数中日韩与字母数字，用来判断是不是空壳 */
export function visibleChars(text: string): number {
  return (text.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) || []).length;
}

/** HTML → 干净正文（无依赖，正则净化；不引 cheerio/jsdom） */
export function htmlToText(html: string): { title: string; text: string; chars: number } {
  const rawTitle = (html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? "")
    .replace(/<[^>]+>/g, "");
  const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();

  const stripped = String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|object|embed|video|audio|form|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, (tag) => (BLOCKY.test(tag) ? "\n" : " "));

  const text = decodeEntities(stripped)
    .replace(/[ \t\r\f\v\u00a0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { title, text, chars: visibleChars(text) };
}

/**
 * 按 charset 解码响应体。中文比赛官网不少仍是 GBK，硬按 UTF-8 解会出乱码——
 * 而乱码会让模型以为「抓到了但内容无关」，比抓不到更坏。
 * 优先级：Content-Type 头 → meta 标签 → UTF-8 兜底。gbk/gb2312 统一升到 gb18030（超集）。
 */
export function decodeBody(buf: Uint8Array, contentType: string): { text: string; charset: string } {
  const pick = (s: string) => /charset=["']?\s*([\w-]+)/i.exec(s)?.[1]?.toLowerCase() ?? "";
  let charset = pick(contentType || "");
  if (!charset) {
    let head = "";
    for (let i = 0; i < Math.min(buf.length, 2048); i++) head += String.fromCharCode(buf[i]);
    charset = pick(head) || pick(head.match(/<meta[^>]+charset[^>]*>/i)?.[0] ?? "");
  }
  const label = /gb-?2312|gbk|gb18030/i.test(charset) ? "gb18030" : charset || "utf-8";
  const attempt = (lbl: string) => {
    try {
      return { text: new TextDecoder(lbl, { fatal: false }).decode(buf), charset: lbl };
    } catch {
      return null; // 该编码本机不支持
    }
  };
  return attempt(label) ?? attempt("utf-8") ?? { text: "", charset: "utf-8" };
}

/* ------------------------------------------------------------------ L1 裸 fetch */

async function fetchStatic(url: string): Promise<{ status: number; html: string; bytes: number; finalUrl: string; truncated: boolean; err: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res: Response;
    try {
      // 手动跟跳：每一跳都重新过 SSRF 校验，防止用 302 把请求拐进内网
      res = await fetch(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(FETCH_MS), headers: HEADERS });
    } catch (e) {
      return { status: 0, html: "", bytes: 0, finalUrl: current, truncated: false, err: String(e).slice(0, 120) };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop === MAX_HOPS) return { status: res.status, html: "", bytes: 0, finalUrl: current, truncated: false, err: "重定向次数过多或缺少 Location" };
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        return { status: res.status, html: "", bytes: 0, finalUrl: current, truncated: false, err: "重定向地址无法解析" };
      }
      // 跟跳只复查 SSRF，不复查 allowlist：正常站点会跳 CDN/去尾斜杠，卡太死等于不能用；
      // 而幻觉风险只在「首个网址」上，那一跳已经查过了。
      const guard = assertSafeUrl(next.href, [next.href]);
      if (!guard.url) return { status: res.status, html: "", bytes: 0, finalUrl: current, truncated: false, err: `重定向被安全校验拦截：${guard.reason}` };
      current = guard.url;
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const clipped = buf.length > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    const { text: html } = decodeBody(clipped, res.headers.get("content-type") ?? "");
    return { status: res.status, html, bytes: buf.length, finalUrl: current, truncated: buf.length > MAX_BYTES, err: "" };
  }
  return { status: 0, html: "", bytes: 0, finalUrl: current, truncated: false, err: "unreachable" };
}

/* ------------------------------------------------------------------ L2 Edge 无头 */

let edgeBin: string | null | undefined;
function findEdge(): string | null {
  if (edgeBin === undefined) edgeBin = EDGE_CANDIDATES.find((p) => existsSync(p)) ?? null;
  return edgeBin;
}

/** 临时空 profile：不复用用户默认 profile，避免带着登录态出门，也不跟已开的浏览器抢锁 */
let edgeProfile: string | null = null;
function edgeProfileDir(): string {
  if (!edgeProfile) edgeProfile = mkdtempSync(join(tmpdir(), "yangyangworkbench-read-"));
  return edgeProfile;
}

function renderWithEdge(url: string): Promise<{ html: string; ms: number; err: string }> {
  const bin = findEdge();
  if (!bin) return Promise.resolve({ html: "", ms: 0, err: "本机没有 Edge/Chrome，无法渲染 JS 站点" });
  const t0 = Date.now();
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-translate", "--safebrowsing-disable-auto-update",
    `--user-data-dir=${edgeProfileDir()}`, "--virtual-time-budget=12000", `--user-agent=${UA}`,
    "--dump-dom", url,
  ];
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 60 * 1024 * 1024, timeout: EDGE_MS }, (err, stdout) => {
      const html = stdout || "";
      resolve({ html, ms: Date.now() - t0, err: err ? String(err.message).slice(0, 120) : "" });
    });
  });
}

/* ------------------------------------------------------------------ 编排 */

/** 读一个公开网址，返回可供模型抽取的正文。全程只读，不写库、不落盘。 */
export async function readUrl(raw: string, allow: string[]): Promise<ReadResult> {
  const guard = assertSafeUrl(raw, allow);
  if (!guard.url) {
    return {
      ok: false, url: String(raw).slice(0, 200), title: "", text: "", chars: 0,
      via: "none", httpStatus: 0, truncated: false, blocked: guard.reason,
      hint: `抓取被拒绝：${guard.reason}。请如实告知用户，绝不允许声称已读取过任何网址。`,
    };
  }
  const url = guard.url;

  const got = await fetchStatic(url);
  let parsed = htmlToText(got.html);
  let via: ReadResult["via"] = "fetch";
  let httpStatus = got.status;
  let note = got.err;

  if (parsed.chars < EDGE_MIN_CHARS) {
    const r = await renderWithEdge(url);
    const alt = htmlToText(r.html);
    if (alt.chars > parsed.chars) {
      parsed = alt;
      via = "edge";
      note = r.err;
    } else if (r.err) {
      note = `${note} / 无头渲染也失败：${r.err}`;
    }
  }

  const ok = parsed.chars >= MIN_OK_CHARS && httpStatus >= 200 && httpStatus < 300;
  const text = parsed.text.length > MAX_TEXT ? parsed.text.slice(0, MAX_TEXT) : parsed.text;
  const truncated = parsed.text.length > MAX_TEXT || got.truncated;

  let hint: string;
  if (!ok) {
    hint =
      `没有读到有效正文（HTTP ${httpStatus || "无响应"}，可见字符仅 ${parsed.chars}${note ? `，${note}` : ""}）。` +
      `这通常说明该站是纯前端渲染或开了人机验证。你必须如实告诉用户读不到，` +
      `并请他把页面截图传进来（工作台支持识图）或直接粘贴关键内容。` +
      `绝不允许把「抓不到」说成「已抓取」，也不允许用猜测填补字段。`;
  } else if (via === "edge") {
    hint = `裸 fetch 正文过短，已改用无头浏览器渲染后取到。只能引用下面 text 里确实出现过的信息。`;
  } else {
    hint = `只能引用下面 text 里确实出现过的信息；没写到的日期、主办方、链接一律留空标待定，绝不从网址本身或常识去猜。`;
  }

  return {
    ok, url, title: parsed.title, text, chars: parsed.chars,
    via, httpStatus, truncated, hint,
  };
}
