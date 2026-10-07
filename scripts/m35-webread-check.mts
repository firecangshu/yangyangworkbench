/**
 * M35 哨兵：只读网页抓取 + 搜索 + 出口校验的纯函数断言。
 * 全程不联网、不触库、不起浏览器——所有网络相关的输入都用 fixture 字符串喂给解析器。
 * 成功打印 M35_PASS，任一断言失败 exit(1)。
 */
import {
  assertSafeUrl,
  collectUrls,
  decodeBody,
  decodeEntities,
  htmlToText,
  visibleChars,
  EDGE_MIN_CHARS,
  MIN_OK_CHARS,
} from "../src/lib/web-read";
import { parseBing, unwrapBing } from "../src/lib/web-search";
import { isLie, lieKind, sanitizeReply, type Capability } from "../src/lib/reply-guard";

let failed = 0;
function ok(cond: boolean, msg: string) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failed++;
}
function eq(actual: unknown, expect: unknown, msg: string) {
  ok(actual === expect, `${msg}（实际 ${JSON.stringify(actual)}）`);
}

const ALLOW = collectUrls("看下 https://www.gov.cn/premier/ 这个，还有 http://a.test.cn/x?a=1 。");

/* ---------------------------------------- 1. 网址抽取 */
console.log("\n[1] collectUrls");
eq(ALLOW.length, 2, "抠出两条网址（粘连的中文句号已剥掉）");
ok(ALLOW.some((u) => u === "https://www.gov.cn/premier/"), "首条精确匹配");
eq(collectUrls("ftp://1.2.3.4/x 和 www.no-scheme.cn 都不算").length, 0, "无协议 / 非 http(s) 不收录");
eq(collectUrls("同一个 https://x.cn/a 出现两次 https://x.cn/a").length, 1, "去重");

/* ---------------------------------------- 2. allowlist + SSRF */
console.log("\n[2] assertSafeUrl");
const deny = (raw: string, why: string) => {
  const r = assertSafeUrl(raw, ALLOW);
  ok(!r.url, `拒绝 ${raw}（${why}）`);
  return r;
};
ok(assertSafeUrl("https://www.gov.cn/premier/", ALLOW).url !== null, "放行：用户消息里出现过的网址");
ok(assertSafeUrl("https://www.gov.cn/premier", ALLOW).url !== null, "放行：尾斜杠差异视为同一条");
eq(assertSafeUrl("https://www.gov.cn/premier/", ALLOW).url, "https://www.gov.cn/premier/", "放行时原样返回用户写的地址（尾斜杠不得削，否则 gov 类站点在 /x ↔ /x/ 间 301 打转）");
deny("https://evil.com/x", "不在 allowlist（防臆造链接）");
deny("http://127.0.0.1:3000/api/contests", "回环 + 端口，SSRF");
deny("http://localhost:3000/x", "localhost");
deny("http://192.168.1.1/admin", "私网段");
deny("http://10.0.0.5/x", "私网段");
deny("http://[::1]/x", "IPv6 回环");
deny("http://2130706433/x", "十进制 IP 变形");
deny("http://intranet/x", "无点主机名");
deny("http://db.internal/x", "内网保留域名");
deny("file:///C:/Windows/win.ini", "非 http 协议");
deny("javascript:alert(1)", "伪协议");
const emptyAllow = assertSafeUrl("https://www.gov.cn/premier/", []);
ok(!emptyAllow.url, "allowlist 为空时一律拒绝");
ok(/没有出现过任何网址/.test(emptyAllow.reason), "allowlist 为空时给出可读原因");

/* ---------------------------------------- 3. HTML → 正文 */
console.log("\n[3] htmlToText");
const PAGE = `<html><head><title> 大赛 &amp; 通知 </title>
<style>body{color:red}</style><script>var x="绝不该出现";</script></head>
<body><nav>首页 登录</nav><h1>报名通知</h1><p>截止日期为 2026-12-31。</p><div>主办方：某某协会</div>
<form><input value="不要这些"></form><!-- 注释 --><p>奖金 &yen;10000</p></body></html>`;
const t = htmlToText(PAGE);
ok(/大赛 & 通知/.test(t.title), "title 解码实体并裁剪");
ok(!/绝不该出现|color:red|首页 登录|不要这些|注释/.test(t.text), "script/style/nav/form/注释 全被剥掉");
ok(/截止日期为 2026-12-31/.test(t.text), "正文保留");
ok(/主办方：某某协会/.test(t.text), "块级元素之间有换行、未粘连");
ok(t.text.includes("\n"), "确实产出多行");
ok(/奖金 ¥10000/.test(t.text), "&yen; 命名实体解码");
eq(visibleChars("中文 abc123 ！！"), 8, "可见字符只数中英数（2+3+3，空格与标点不算）");
eq(decodeEntities("&#x4f60;&#x597d; &nbsp;"), "你好  ", "实体解码");

/* ---------------------------------------- 4. 字符集 */
console.log("\n[4] decodeBody");
const GBK_BYTES = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // 你好
eq(decodeBody(GBK_BYTES, "text/html; charset=GBK").text, "你好", "GBK 响应头正确解码");
eq(decodeBody(GBK_BYTES, "text/html; charset=gb2312").charset, "gb18030", "gb2312 升级到超集 gb18030");
const META = new Uint8Array([...new TextEncoder().encode(`<head><meta charset="gbk"></head>`), 0xc4, 0xe3, 0xba, 0xc3]);
ok(/你好/.test(decodeBody(META, "text/html").text), "无响应头时从 meta 探测字符集");
eq(decodeBody(META, "text/html").charset, "gb18030", "meta 探到的 gbk 同样升到 gb18030");
eq(decodeBody(new Uint8Array([0xe4, 0xbd, 0xa0]), "text/html; charset=bogus-xyz").text, "你", "未知编码回落 UTF-8 不抛异常");

/* ---------------------------------------- 5. Bing 解析 */
console.log("\n[5] parseBing / unwrapBing");
const BING_FIXTURE = `<html><body>
<li class="b_algo"><h2><a href="https://ai-bot.cn/">AI工具集官网</a></h2><p class="b_lineclamp">1000+ AI工具导航</p></li>
<li class="b_algo"><h2><a href="https://tanqingbo.cn/ai-tools-guide/" h="1">AI 工具完全指南（2026）</a></h2><p>ChatGPT、Kimi 用法</p></li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLm9yZy9wYWdl&ntb=1">被包起来的结果</a></h2><p>摘要</p></li>
<li class="b_algo"><h2><a href="https://cn.bing.com/noise">站内导航噪音</a></h2><p>忽略</p></li>
</body></html>`;
const hits = parseBing(BING_FIXTURE);
eq(hits.length, 3, "解析出 3 条（含 ck/a 还原，剔除 bing 站内噪音）");
eq(hits[0]?.title, "AI工具集官网", "标题正确");
eq(hits[0]?.url, "https://ai-bot.cn/", "直链保留");
eq(hits[0]?.snippet, "1000+ AI工具导航", "摘要正确");
eq(hits[2]?.url, "https://example.org/page", "ck/a 的 base64url 还原成真实外链");
eq(parseBing("<html>没有结果</html>").length, 0, "无 b_algo 时返回空数组");
eq(unwrapBing("https://direct.cn/x"), "https://direct.cn/x", "非 ck/a 链接原样返回");

/* ---------------------------------------- 6. 出口校验：该拦的 */
console.log("\n[6] 假话拦截 —— 该拦的必须拦住");
const NO: Capability = { fetch: false, search: false };
const MUST_BLOCK: [string, string, Capability][] = [
  ["已根据网址爬取并完善了AI赛事的相关信息。", "M35 起点：谎称爬过网址", NO],
  ["我已经抓取了官网页面内容。", "谎称抓取", NO],
  ["我已联网查询了最新信息。", "谎称联网", NO],
  ["我在网上搜索了相关资料。", "谎称搜索", NO],
  ["已为你登记这场比赛。", "谎称写库", NO],
  ["我已经将这场比赛的资料登记进系统了。", "活体实测谎句：反向语序（将…登记进系统）", NO],
  ["这场比赛的信息已经登记进来了。", "活体实测谎句：主语在前的被动式", NO],
  ["已登记好了，你自己在台账里查看。", "谎称写库：完成态不带宾语（第二人称词不能救它）", NO],
  ["已将信息录入台账。", "谎称写库：录入台账", NO],
  ["已为 ARC-Bench 建好文件夹。", "谎称建目录", NO],
  ["我已经把资料保存到磁盘。", "谎称存盘", NO],
  ["已创建文件夹，无法修改。", "否定词在动作之后，仍算假话", NO],
  ["已根据网址爬取并完善了内容。", "抓取失败时同样要拦", { fetch: false, search: true }],
];
for (const [s, why, cap] of MUST_BLOCK) ok(isLie(s, cap), `拦：${why}`);

/* ---------------------------------------- 7. 出口校验：该放的 */
console.log("\n[7] 假话拦截 —— 该放的绝不能误伤");
const MUST_PASS: [string, string, Capability][] = [
  ["台账里没有登记相关路径，我也没有创建文件夹的能力。", "实话：否定词紧邻动作", NO],
  ["我无法读取这个网址的内容。", "实话：承认读不到", NO],
  ["这个网址我没能抓到正文。", "实话：抓取失败", NO],
  ["你可以自己建一个文件夹。", "第二人称建议", NO],
  ["已经核对过，这场比赛尚未登记进系统。", "实话：否定词落在「已」与动词之间", NO],
  ["已经读取完正文，登记还需要你在预览卡上确认。", "实话：真动作 + 把登记交回给用户", { fetch: true, search: false }],
  ["已经把页面读完了，但没找到截止日期。", "实话：前半真动作后半承认缺信息", { fetch: true, search: false }],
  ["建议你访问官网确认截止日期。", "建议 + 含「访问官网」", NO],
  ["已生成融入方案预览，请在卡片上点确认融入。", "真动作：预览确实生成了", NO],
  ["查询了工作台状态：共 8 个项目、6 场比赛。", "真动作：只读查询", NO],
  ["我已根据网址抓取了内容，截止日期是 12 月 31 日。", "read_url 成功后这是真话", { fetch: true, search: false }],
  ["我搜索了网络，找到三条结果。", "search_web 成功后这是真话", { fetch: false, search: true }],
];
for (const [s, why, cap] of MUST_PASS) ok(!isLie(s, cap), `放：${why}`);

/* ---------------------------------------- 8. 能力标记必须真的改变判定 */
console.log("\n[8] 同一句在 cap 开/关下判定相反（防写死的假豁免）");
const LIE = "我已根据网址抓取了内容。";
eq(lieKind(LIE, NO), "net", "fetch=false → 判为联网类假话");
eq(lieKind(LIE, { fetch: true, search: false }), null, "fetch=true → 放行");

/* ---------------------------------------- 9. sanitizeReply */
console.log("\n[9] sanitizeReply");
const dirty = "已根据网址爬取并完善了AI赛事的相关信息。截止日期是 2026-12-31。";
const after = sanitizeReply(dirty, NO);
ok(!/爬取/.test(after), "假话句被删掉");
ok(/截止日期是 2026-12-31/.test(after), "真信息保留");
ok(/没能读到这个网址/.test(after), "补了一句实话（联网类说明）");
eq(sanitizeReply("共 8 个项目。", NO), "共 8 个项目。", "干净文本原样返回，不加尾巴");
const fsDirty = "已为 ARC-Bench 建好文件夹。请核对。";
ok(/不能创建/.test(sanitizeReply(fsDirty, NO)) && !/没能读到这个网址/.test(sanitizeReply(fsDirty, NO)), "磁盘类假话补的是磁盘说明（而不是联网说明）");
const multi = "已创建文件夹。\n（空括号）\n正文还在。";
ok(!/[（(]\s*[）)]/.test(sanitizeReply(multi, NO)), "删句后残留的空括号被扫掉");

/* ---------------------------------------- 10. 阈值自洽 */
console.log("\n[10] 阈值");
ok(MIN_OK_CHARS < EDGE_MIN_CHARS, "MIN_OK < EDGE_MIN：空壳一定先试过无头浏览器才判失败");
ok(EDGE_MIN_CHARS === 600 && MIN_OK_CHARS === 80, "阈值与实测数据一致（kaggle 64 字符 < 80 → 判被拦）");

if (failed > 0) {
  console.log(`\nM35_CHECK_FAILED: ${failed} 条断言未过`);
  process.exit(1);
}
console.log("M35_PASS");
