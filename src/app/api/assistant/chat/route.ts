import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider, readKey, ASSISTANT_PROVIDERS } from "@/lib/assistant";
import { buildIntegrationPlan, type ExtractedContest, type IntegrationPlan } from "@/lib/contest-integration";
import { stat } from "fs/promises";
import { collectUrls, readUrl, type ReadResult } from "@/lib/web-read";
import { searchWeb, type SearchResult } from "@/lib/web-search";
import { sanitizeReply, type Capability } from "@/lib/reply-guard";

/**
 * AI 对话助手（M17）：POST /api/assistant/chat
 * - 多家免费 LLM（OpenAI 兼容）可切换，key 只从本地 credentials 文件读（红线①）
 * - 工具调用查状态/新增比赛：写操作走与网页端同一条 Prisma 事务 + 流水（红线⑤单一权威）
 * - 无 key / 调用失败：降级返回可读提示，不崩（多重保障：一家不行 UI 上换下一家）
 */

const SYSTEM_PROMPT = `你是「杨杨的AI比赛专用工作台」内置的AI助手，帮助用户协调比赛创作工作。
你可以调用工具：query_status 查询工作台状态（项目/比赛/工具卡数量、临近截止的比赛），locate_paths 定位本地真实路径（只读，会现场校验该路径在磁盘上是否真的存在），read_url 读取公开网页正文（只读），search_web 搜索公开网页（只读，返回标题/链接/摘要），analyze_contest_integration 赛事融入分析（新比赛入场的唯一入口）。
要查外部资料时按这个顺序走：消息里已有网址 → 直接 read_url 拿正文；没给网址但需要找 → 先 search_web 找到候选链接，再对选中那条 read_url；拿到正文后才调 analyze_contest_integration 出预览。
read_url / search_web 的返回必须逐字对照：只有 text 或 results 里确实出现过的信息才能写进回答或字段。抓取失败（ok=false）时必须照实说「这个网址我读不到（可能是纯前端渲染或有人机验证），请把页面截图传进来或直接把关键内容粘给我」，绝不允许改口称已读取，也不允许用常识或猜测补字段。
用户问「XX 比赛/项目/资料的文件夹在哪、完整路径是什么」时：必须先调用 locate_paths，并且只能引用它返回的那条路径。exists=true 才能说是本机现有目录；exists=false 要说「台账登记过这个路径，但磁盘上已经找不到了（可能被移动或删除）」；matched=0 要说「台账里没有登记相关路径，我也没有创建文件夹的能力」。此时可以给一个「建议路径」，但必须明说是建议、需他自己去建。绝不把未经 locate_paths 返回的路径说成已存在。
当用户要登记/融入/规划任何新比赛时（无论一句话、整段官网资讯还是一个网址）：一律先调用 analyze_contest_integration 生成「融入方案预览」——它会把资讯抽成结构化字段、去重比对现有比赛、拆解材料清单与日历提醒，供用户逐项核对；该工具只读，绝不写库。只有用户在预览卡上点「确认融入」后，系统才会真正落库联动各板块。严禁绕过确认门直接写库或声称已录入。
铁律：绝不编造事实。用户没说的日期、主办方、链接，一律留空（会标「待定」）；日期必须是用户明确给出的（红线：不脑补日期）。
能力边界：你只有上面五个只读工具。read_url 只能 GET 公开网页，不能登录、不能提交表单、不能绕过验证码，也只能抓用户消息里出现过、或 search_web 刚刚返回过的网址；locate_paths 只能读台账里登记的地址并校验其在磁盘上是否存在。你没有任何写能力——不能创建/改名/移动/删除文件或文件夹，不能写入或修改台账，也不能自行浏览磁盘（用户在对话框上传的附件是前端读好拼进消息给你的，不是你自己去磁盘读的）。因此严禁说「已建立文件夹」「已保存到磁盘」「已登记」「已爬取完成」这类完成态假话。
回答用中文、口语化、简短（不超过150字，列表除外）。`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_status",
      description: "查询工作台当前状态：项目数、比赛数、工具卡数、临近截止的比赛清单",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "locate_paths",
      description: "只读定位本地路径：按关键词在台账（项目路径、交付物路径、比赛关联的项目）里查已登记的真实磁盘地址，并现场 stat 校验每条在磁盘上是否确实存在。用于回答「XX 的文件夹/资料在哪、完整地址是什么」。查不到会明确返回未登记——工作台不会创建文件夹，未登记即不存在。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "关键词：比赛名、项目名、路径片段均可；留空则返回全部已登记路径概览" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_url",
      description:
        "只读抓取一个公开网页的正文（服务端 GET，自动识别字符集；正文过短时会再用无头浏览器补一次 JS 渲染）。只能抓用户消息里出现过、或 search_web 刚返回过的网址，内网地址一律不允许访问。返回 ok=false 表示没有读到内容（纯前端渲染或人机验证），此时必须照实说读不到并请用户截图或粘贴正文。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要读取的网址，必须与用户消息里贴的那条一致" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description:
        "只读搜索公开网页（无需 API key）。用户没给网址、只知道比赛名或主题时用它先找；返回标题/链接/摘要。要读某一页的详细内容，必须再对该 url 调用 read_url。注意：这条通道对「一个完整短语」结果很准，对堆砌的多个关键词会被拆词污染，结果只能当候选链接用。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "一次只查一件事：给完整比赛名，推荐用英文双引号整体括起来（如 \"腾讯云黑客松\"）。不要堆多个关键词，site: 等操作符无效。" },
          limit: { type: "number", description: "返回条数 1-8，默认 5" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_contest_integration",
      description: "赛事融入分析（只读）：从用户提供的比赛官网资讯抽取结构化字段，去重比对现有比赛，生成融入方案预览（Contest+材料清单+日历提醒+里程碑）。绝不写库，仅供用户确认。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "比赛名称（必填）" },
          organizer: { type: "string", description: "主办方；没说留空" },
          track: { type: "string", description: "赛道/方向" },
          theme: { type: "string", description: "赛事主题" },
          content: { type: "string", description: "赛事内容概述" },
          trackAnalysis: { type: "string", description: "赛道分析（根据资料归纳，无把握留空）" },
          startDate: { type: "string", description: "开始日期 YYYY-MM-DD；用户明确说了才填，绝不猜" },
          deadline: { type: "string", description: "提交截止日期 YYYY-MM-DD；明确说了才填" },
          resultDate: { type: "string", description: "结果公布日期 YYYY-MM-DD；明确说了才填" },
          submitLink: { type: "string", description: "报名/提交链接；没说留空" },
          notes: { type: "string", description: "备注" },
          timeNodes: {
            type: "array",
            description: "其他关键时间节点（报名/初筛/路演等），每项 label+date；date 未明确则留空",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                date: { type: "string", description: "YYYY-MM-DD，未明确留空" },
              },
            },
          },
          requirements: {
            type: "array",
            description: "官方递交要求（内容/材料/标准/格式），每项 name+standard；按官方原文，不臆造",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "材料/要求名称" },
                standard: { type: "string", description: "标准/格式要求；无则留空" },
                deadline: { type: "string", description: "该项截止日 YYYY-MM-DD；无则留空" },
              },
            },
          },
          source: { type: "string", description: "用户提供的原始资讯文本存档（可含 URL），直接回传以便入库溯源" },
        },
        required: ["name"],
      },
    },
  },
];

/** 把 LLM 工具参数防御式转成 ExtractedContest（数组/字段缺失一律兜底，不臆造） */
function toExtracted(args: Record<string, unknown>): ExtractedContest {
  const s = (v: unknown) => String(v ?? "").trim();
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const timeNodes = arr(args.timeNodes).map((n) => {
    const o = (n ?? {}) as Record<string, unknown>;
    return { label: s(o.label), date: s(o.date) };
  }).filter((n) => n.label);
  const requirements = arr(args.requirements).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { name: s(o.name), standard: s(o.standard), deadline: s(o.deadline) };
  }).filter((r) => r.name);
  return {
    name: s(args.name), organizer: s(args.organizer), track: s(args.track),
    theme: s(args.theme), content: s(args.content), trackAnalysis: s(args.trackAnalysis),
    startDate: s(args.startDate), deadline: s(args.deadline), resultDate: s(args.resultDate),
    submitLink: s(args.submitLink), notes: s(args.notes),
    timeNodes, requirements, source: s(args.source),
  };
}

/**
 * 只读路径定位：台账本来就存了真实磁盘地址（Project.path / Deliverable.path），但此前 query_status
 * 只报数量不报路径，模型拿不到真地址才去编。这里把真地址给它，并逐条 stat 现场校验——
 * 从此能区分「没登记过」与「登记过但磁盘上没了」两种截然不同的事实。
 * 全程只读（findMany + fs.stat），不 mkdir、不写库（红线②④）。
 */
async function locatePaths(query: string) {
  const q = query.trim().toLowerCase();
  const [projects, deliverables] = await Promise.all([
    prisma.project.findMany({
      include: { contestLinks: { include: { contest: { select: { name: true } } } } },
    }),
    prisma.deliverable.findMany({
      where: { path: { not: "" } },
      include: { contest: { select: { name: true } } },
    }),
  ]);

  type Hit = { kind: string; name: string; path: string; contests: string[] };
  const hits: Hit[] = [];

  for (const p of projects) {
    const contests = p.contestLinks.map((l) => l.contest.name);
    const hay = [p.name, p.path, p.summary, p.tags, ...contests].join(" ").toLowerCase();
    if (q && !hay.includes(q)) continue;
    hits.push({ kind: "项目", name: p.name, path: p.path, contests });
  }
  for (const d of deliverables) {
    const cname = d.contest?.name ?? "";
    const hay = [d.name, d.path, cname].join(" ").toLowerCase();
    if (q && !hay.includes(q)) continue;
    hits.push({ kind: "交付物", name: d.name, path: d.path, contests: cname ? [cname] : [] });
  }

  const CAP = 20;
  const items = await Promise.all(
    hits.slice(0, CAP).map(async (h) => {
      let exists = false;
      let isDirectory = false;
      try {
        const st = await stat(h.path);
        exists = true;
        isDirectory = st.isDirectory();
      } catch {
        /* 不存在或无权限：如实回 exists=false，由模型照实说，不粉饰 */
      }
      return { ...h, exists, isDirectory };
    }),
  );

  if (items.length === 0) {
    return {
      matched: 0,
      items: [],
      hint: q
        ? `台账里没有与「${query.trim()}」匹配的路径登记。工作台不会创建文件夹，未登记即代表不存在——请如实告知用户，最多给一条标明为「建议」的路径。`
        : "台账里还没有任何带路径的登记。",
    };
  }
  return {
    matched: hits.length,
    returned: items.length,
    truncated: hits.length > CAP,
    items,
    hint: "以上路径均来自台账登记并已做磁盘校验；只能引用这里出现过的路径。",
  };
}

async function runTool(name: string, args: Record<string, unknown>, ctx: { allowUrls: string[] }) {
  if (name === "query_status") {
    const [projects, contests, connections] = await Promise.all([
      prisma.project.count(),
      prisma.contest.count(),
      prisma.connection.count(),
    ]);
    const now = new Date();
    const soon = (await prisma.contest.findMany({ orderBy: { deadline: "asc" } }))
      .filter((c) => c.deadline && new Date(c.deadline) >= now)
      .slice(0, 5)
      .map((c) => ({ name: c.name, deadline: c.deadline, status: c.status }));
    const openContests = await prisma.contest.count({ where: { status: { in: ["research", "registered", "preparing"] } } });
    return { projects, contests, openContests, connections, deadlineSoon: soon };
  }
  if (name === "locate_paths") {
    // 只读：查台账路径 + stat 校验，不写库不碰磁盘内容
    return await locatePaths(String(args.query ?? ""));
  }
  if (name === "read_url") {
    // 只读：GET 公开网页。allowUrls 把住「只能抓用户贴过的那几条」，防模型臆造链接
    return await readUrl(String(args.url ?? ""), ctx.allowUrls);
  }
  if (name === "search_web") {
    // 只读：Bing 结果页解析，无需 API key
    return await searchWeb(String(args.query ?? ""), Number(args.limit ?? 5));
  }
  if (name === "analyze_contest_integration") {
    // 只读：抽取字段→去重比对现有赛→组装融入方案预览。全程不写库（方案甲，写入待用户确认）。
    const ex = toExtracted(args);
    const existing = await prisma.contest.findMany({ select: { id: true, name: true, organizer: true, deadline: true } });
    const tpl = await prisma.sopTemplate.findFirst({
      where: { name: "赛事融入标准手册" },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    const steps = (tpl?.steps ?? []).map((s) => s.name);
    const plan = buildIntegrationPlan(ex, existing, steps);
    return plan;
  }
  return { error: `未知工具 ${name}` };
}

/**
 * 出口硬校验已抽到 @/lib/reply-guard（M35）：抽出来是为了哨兵能直接 import 断言，
 * 不再用「从本文件源码正则抠常量再 eval」那种脆弱手法。
 */

type ChatMessage = { role: string; content: unknown; images?: { name?: string; dataUrl?: string }[]; [k: string]: unknown };

/** 本轮是否带了附件图片（只认 data: 开头的 base64 URL，不接收外链） */
function hasImages(msgs: ChatMessage[]) {
  return msgs.some((m) => m.role === "user" && (m.images ?? []).some((x) => String(x?.dataUrl ?? "").startsWith("data:")));
}

/** 带图的用户消息转 OpenAI 兼容的多模态 content 数组，其余消息原样 */
function toApiMessage(m: ChatMessage): ChatMessage {
  const urls = (m.images ?? []).map((x) => String(x?.dataUrl ?? "")).filter((u) => u.startsWith("data:"));
  if (m.role !== "user" || urls.length === 0) return { role: m.role, content: m.content };
  return {
    role: "user",
    content: [
      { type: "text", text: String(m.content ?? "") },
      ...urls.map((url) => ({ type: "image_url", image_url: { url } })),
    ],
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const providerId = String(body.provider ?? "glm");
  const provider = getProvider(providerId) ?? ASSISTANT_PROVIDERS[0];
  const history = Array.isArray(body.messages) ? (body.messages as ChatMessage[]).slice(-20) : [];
  const userMsgs = history.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return NextResponse.json({ error: "没有用户消息" }, { status: 400 });

  // 附件文本已由前端拼进 content；图片只有识图模型能吃，否则明确告知去哪切（不默默丢图）
  const withImages = hasImages(history);
  if (withImages && !provider.vision) {
    return NextResponse.json({
      degraded: true, provider: provider.id,
      reply:
        `${provider.label} 不支持图片识别。\n` +
        `请在上方下拉切到「智谱 GLM-4V-Flash（免费·识图）」后重发（与 GLM 共用同一个 key），或把图里的关键信息用文字描述给我。\n` +
        `文本附件不受影响，照常分析。`,
      tools: [],
    });
  }

  const key = await readKey(provider.keyFile);
  if (!key) {
    return NextResponse.json({
      degraded: true,
      provider: provider.id,
      reply:
        `还没配置 ${provider.label} 的 API key。\n` +
        `开通方法：${provider.note}，拿到 key 后保存到工作台目录下的 ${provider.keyFile}（一行文本即可）。\n` +
        `也可以在设置页或助手面板切换到其他已配好 key 的模型（多重保障）。`,
      tools: [],
    });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + (withImages ? "\n用户本轮附了图片：先如实读图（图上写什么就是什么），没写清的日期/链接一律标待定，绝不猜。" : "") },
    ...history.map(toApiMessage),
  ];
  const toolsCalled: { name: string; args: unknown }[] = [];
  let integration: IntegrationPlan | null = null;

  // 可抓网址有两个来源：用户自己贴过的，加上本轮 search_web 真返回过的。
  // 只放用户消息会把「搜→挑一条→抓」这条合法链路堵死（活体实测：模型拿搜索结果里的链接被挡下后一直空转到轮次耗尽）；
  // 而搜索结果是我们自己工具的输出，不是模型臆造，放进去不削弱防臆造；内网地址每跳仍过 SSRF 校验，搜索引擎给出 127.0.0.1 也照样拦。
  // 附件文本已由前端拼进 content，所以一并覆盖到。
  const allowUrls = collectUrls(
    history.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n"),
  );
  // 能力事实：本轮 read_url / search_web 是否真成功过。出口校验据此决定「已抓取/已搜索」算真话还是假话。
  const cap: Capability = { fetch: false, search: false };

  const call = async (opts: { withTools?: boolean } = {}) => {
    const withTools = opts.withTools !== false;
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      // 识图模型不走 function calling：带图轮次不塞 tools，避免上游 400
      body: JSON.stringify({ model: provider.model, messages, ...(withImages || !withTools ? {} : { tools: TOOLS, tool_choice: "auto" }) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
    return res.json();
  };

  let data;
  try {
    data = await call();
  } catch (e) {
    return NextResponse.json({
      degraded: true, provider: provider.id,
      reply: `${provider.label} 调用失败：${String(e)}。可在上方切换到其他模型后重试（多重保障）。`,
      tools: toolsCalled,
    });
  }

  // 工具循环：最多四轮。M35 加了搜索和抓取后，「search_web → read_url → analyze_contest_integration → 回答」
  // 是合法的四步链路，旧的两轮预算会在模型正常连查两次搜索时就把它截断（活体测试踩到）。
  for (let round = 0; round < 4; round++) {
    const msg = data.choices?.[0]?.message;
    const calls = msg?.tool_calls;
    if (!calls?.length) {
      return NextResponse.json({
        ok: true, provider: provider.id, model: provider.model,
        reply: sanitizeReply(String(msg?.content ?? "（模型返回空回复）"), cap),
        tools: toolsCalled,
        integration,
      });
    }
    messages.push(msg);
    for (const tc of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* 容错：按空参数处理 */ }
      const fnName = String(tc.function?.name ?? "");
      toolsCalled.push({ name: fnName, args });
      const result = await runTool(fnName, args, { allowUrls }).catch((e) => ({ error: String(e) }));
      if ((result as { error?: string })?.error === undefined) {
        if (fnName === "analyze_contest_integration") integration = result as IntegrationPlan;
        if (fnName === "read_url" && (result as ReadResult).ok) cap.fetch = true;
        if (fnName === "search_web" && (result as SearchResult).ok) {
          cap.search = true;
          // 搜索命中的链接当场参加可抓名单，下一轮 read_url 才能合法拿正文
          for (const h of (result as SearchResult).results ?? []) {
            if (h.url && !allowUrls.includes(h.url)) allowUrls.push(h.url);
          }
        }
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    try {
      data = await call();
    } catch (e) {
      return NextResponse.json({
        degraded: true, provider: provider.id,
        reply: `工具已执行，但生成最终回复时模型调用失败：${String(e)}。可切换模型重试。`,
        tools: toolsCalled,
      });
    }
  }

  // 预算耗尽不等于手上没材料：模型可能已经读到了正文只是在筹备下一次工具调用。
  // 再打一发不带 tools 的请求，强制它用已有信息说完（cap 不变，所以该拦的谎在这一发里照样拦）。
  let final = data.choices?.[0]?.message;
  try {
    const summed = await call({ withTools: false });
    const m = summed.choices?.[0]?.message;
    if (String(m?.content ?? "").trim()) final = m;
  } catch { /* 上游不支持不列 tools 时直接沿用上一轮内容 */ }

  return NextResponse.json({
    ok: true, provider: provider.id, model: provider.model,
    reply: sanitizeReply(String(final?.content ?? "（工具调用轮次已用完，还没能拼出完整答案。请把需求拆得更具体一点，或者直接把网页正文粘贴给我。）"), cap),
    tools: toolsCalled,
    integration,
  });
}
