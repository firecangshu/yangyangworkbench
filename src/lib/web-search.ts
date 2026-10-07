/**
 * 只读网页搜索（M35）：给助手「不知道网址时先找」的能力。
 *
 * 为什么是 Bing 裸 fetch，而不是那些高星方案（都是本机实测出来的结论）：
 *   · html.duckduckgo.com —— fetch failed，这台机器网络层不通
 *   · r.jina.ai —— fetch failed，同样不通（宣传里的「零配置」在此环境是死的）
 *   · Bing 裸 fetch —— HTTP 200 / 703ms / 正则解析出 9 条真实结果，无需 API key、无需开浏览器
 *   · 百度 —— 也通，但 1.6MB / 5.2s，体积与耗时都是 Bing 的七倍以上
 * Firecrawl / Crawl4AI / Scrapling 的「绕过反爬」靠付费代理 IP 池与指纹浏览器，
 * 自托管还要 Docker + Redis，违反红线②（单进程不并引擎），故不引入。
 *
 * 全程只读：不写库、不落盘、不提交任何表单。
 */
import { decodeEntities, htmlToText, visibleChars } from "./web-read";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const ENDPOINT = "https://www.bing.com/search";
const FETCH_MS = 15_000;
const MAX_BYTES = 600 * 1024;

export type WebHit = { title: string; url: string; snippet: string };
export type SearchResult = {
  ok: boolean;
  query: string;
  results: WebHit[];
  httpStatus: number;
  blocked?: string;
  hint: string;
};

/** Bing 与微软自家域名的导航噪音，不是搜索结果 */
const INTERNAL = /(^|\.)(bing|microsoft|msftconnecttest|go\.microsoft)\.com$/i;

function tagStrip(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Bing 有时把外链包成 /ck/a?...&u=a1<base64url>，需还原成真实地址 */
export function unwrapBing(href: string): string {
  if (!/bing\.com\/ck\/a/i.test(href)) return href;
  try {
    const u = new URL(href);
    const enc = u.searchParams.get("u");
    if (!enc || !enc.startsWith("a1")) return href;
    const raw = Buffer.from(enc.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return /^https?:\/\//i.test(raw) ? raw : href;
  } catch {
    return href;
  }
}

/** 从 Bing 结果页 HTML 解析条目（纯函数，可离线用 fixture 断言） */
export function parseBing(html: string): WebHit[] {
  const out: WebHit[] = [];
  const seen = new Set<string>();
  const chunks = String(html ?? "").split(/<li\s+class="b_algo/i).slice(1);
  for (const chunk of chunks) {
    const h2 = /<h2[^>]*>([\s\S]{0,600}?)<\/h2>/i.exec(chunk)?.[1] ?? "";
    const href = /<a[^>]*\shref="([^"]+)"/i.exec(h2)?.[1] ?? "";
    const title = tagStrip(h2.replace(/<a[^>]*>/gi, "").replace(/<\/a>/gi, ""));
    if (!href || !title) continue;
    let url = decodeEntities(href.replace(/&amp;/g, "&"));
    url = unwrapBing(url);
    if (!/^https?:\/\//i.test(url)) continue;
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (INTERNAL.test(host)) continue;

    const snippet = tagStrip(/<p[^>]*>([\s\S]{0,600}?)<\/p>/i.exec(chunk)?.[1] ?? "").slice(0, 220);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: title.slice(0, 160), url, snippet });
  }
  return out;
}

/** 搜索公开网页。limit 1-8。 */
export async function searchWeb(query: string, limit = 5): Promise<SearchResult> {
  const q = String(query ?? "").trim();
  if (!q) {
    return { ok: false, query: q, results: [], httpStatus: 0, blocked: "搜索词为空", hint: "请如实告知用户需要给出搜索关键词。" };
  }
  const n = Math.max(1, Math.min(8, Math.trunc(limit) || 5));
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&setmkt=zh-CN&count=${n}`;

  let status = 0;
  let html = "";
  let err = "";
  try {
    // Bing 会 301 到 cn.bing.com，跟跳是必须的（活体测试发现：manual 会把搜索直接判死）。
    // 这里主机写死在 bing.com，不存在被诱导去内网的风险，故跟跳后只复查最终落点仍是 Bing。
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    status = res.status;
    if (!/bing\.com$/i.test(new URL(res.url).hostname)) {
      return { ok: false, query: q, results: [], httpStatus: status, blocked: "跳转离开了 Bing", hint: "搜索服务跳转到了预期之外的站点，已中止。请如实告知用户搜不到。" };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const clipped = buf.length > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    html = new TextDecoder("utf-8", { fatal: false }).decode(clipped);
  } catch (e) {
    err = String(e).slice(0, 140);
  }

  const results = parseBing(html).slice(0, n);
  const ok = results.length > 0;
  // 实测规律（本机无 key 通道）：一个完整短语结果很准；堆多个关键词会被拆词污染，
  // site: 等操作符被完全忽略。所以偏散的查询要提醒收紧，而不是假装结果可靠。
  const tokenCount = q.split(/\s+/).filter(Boolean).length;
  const loose = tokenCount >= 4 || /site:/i.test(q);

  const hint = ok
    ? (loose
        ? "本次关键词偏散，这个无密钥搜索通道会把多词拆开匹配，结果可能只命中其中一个词。建议收紧成**一个完整短语**（可用英文双引号把比赛全称括起来）重查一次。\n"
        : "") +
      "这些只是搜索结果的标题与摘要。要拿某页的详细内容，必须再对那条 url 调用 read_url；不许凭标题或摘要臆造日期、主办方等字段。"
    : `搜索没有取到结果（HTTP ${status || "无响应"}${err ? `，${err}` : ""}${html ? `，正文可见字符 ${visibleChars(htmlToText(html).text)}` : ""}）。` +
      `请如实告知用户搜不到，可以建议他换个关键词，或直接把网页截图/内容贴进来。绝不允许声称已搜索过网络。`;

  return { ok, query: q, results, httpStatus: status, blocked: ok ? undefined : err || "无结果", hint };
}
