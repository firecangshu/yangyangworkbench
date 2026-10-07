import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider, readKey, ASSISTANT_PROVIDERS } from "@/lib/assistant";
import { buildIntegrationPlan, type ExtractedContest, type IntegrationPlan } from "@/lib/contest-integration";
import { stat } from "fs/promises";

/**
 * AI 对话助手（M17）：POST /api/assistant/chat
 * - 多家免费 LLM（OpenAI 兼容）可切换，key 只从本地 credentials 文件读（红线①）
 * - 工具调用查状态/新增比赛：写操作走与网页端同一条 Prisma 事务 + 流水（红线⑤单一权威）
 * - 无 key / 调用失败：降级返回可读提示，不崩（多重保障：一家不行 UI 上换下一家）
 */

const SYSTEM_PROMPT = `你是「杨杨的AI比赛专用工作台」内置的AI助手，帮助用户协调比赛创作工作。
你可以调用工具：query_status 查询工作台状态（项目/比赛/工具卡数量、临近截止的比赛），locate_paths 定位本地真实路径（只读，会现场校验该路径在磁盘上是否真的存在），analyze_contest_integration 赛事融入分析（新比赛入场的唯一入口）。
用户问「XX 比赛/项目/资料的文件夹在哪、完整路径是什么」时：必须先调用 locate_paths，并且只能引用它返回的那条路径。exists=true 才能说是本机现有目录；exists=false 要说「台账登记过这个路径，但磁盘上已经找不到了（可能被移动或删除）」；matched=0 要说「台账里没有登记相关路径，我也没有创建文件夹的能力」。此时可以给一个「建议路径」，但必须明说是建议、需他自己去建。绝不把未经 locate_paths 返回的路径说成已存在。
当用户要登记/融入/规划任何新比赛时（无论一句话还是粘贴整段官网资讯）：一律先调用 analyze_contest_integration 生成「融入方案预览」——它会把资讯抽成结构化字段、去重比对现有比赛、拆解材料清单与日历提醒，供用户逐项核对；该工具只读，绝不写库。只有用户在预览卡上点「确认融入」后，系统才会真正落库联动各板块。严禁绕过确认门直接写库或声称已录入。
铁律：绝不编造事实。用户没说的日期、主办方、链接，一律留空（会标「待定」）；日期必须是用户明确给出的（红线：不脑补日期）。
能力边界：你只有上面三个只读工具。locate_paths 只能读台账里登记的地址并校验其在磁盘上是否存在，你依然没有文件系统写能力——不能创建/改名/移动/删除任何文件或文件夹，也不能自行浏览磁盘（用户在对话框上传的附件是前端读好拼进消息给你的，不是你自己去磁盘读的）。因此严禁说「已建立文件夹」「已保存到磁盘」这类完成态假话。
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

async function runTool(name: string, args: Record<string, unknown>) {
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
 * 出口硬校验：拦掉「声称做了自己做不到的事」的假话。
 * 不靠 prompt 自觉（M32 教训）：助手三个工具全是只读（locate_paths 也只读台账 + stat），所以——
 *   FS_CLAIM：声称动过磁盘/建过文件夹（它没 fs 能力）
 *   DB_CLAIM：声称已登记/已参加比赛列表/已设提醒（M32 后它没有任何写工具，只能出预览）
 * 第二人称建议（「你可以自己建一个文件夹」）是正当回答，不拦；但同一句里带完成态（已/已经）则照拦。
 * 「已生成融入方案预览」「查询了工作台状态」这类真动作不受影响。
 */
const FS_CLAIM = /(创建|建立|新建|建起|保存|写入|存放|存好|放好|准备好|生成|建了).{0,20}(文件夹|目录|磁盘|本地文件|workspace)|(建好了|建完了|创建完毕)/;
const DB_CLAIM = /(已|已经).{0,12}(登记|录入|添加|新增|创建|保存|写入|存入|设置|安排).{0,16}(比赛|赛事|提醒|日历|交付物|材料|待办)|(已|已经).{0,8}为(你|您).{0,12}(设置|添加|登记|安排)/;
const ADVICE = /(你可以|你也可以|你能|建议你|请自行|自行|自己建|手动|由你|你需要)/;
const DONE_MARK = /我已经|我已|已经|已/;
const FS_LIE_NOTE = "（说明：我只能查询台账和生成融入方案预览，不会写入台账、也不能创建或改动任何文件/文件夹。要落库请在预览卡上点「确认融入」；要工作目录请你自己建，我可以把建议路径发给你。）";

/** 该句是不是完成态假话 */
function isLie(sentence: string) {
  if (!FS_CLAIM.test(sentence) && !DB_CLAIM.test(sentence)) return false;
  return !(ADVICE.test(sentence) && !DONE_MARK.test(sentence));
}

function sanitizeReply(text: string): string {
  const parts = text.split(/(?<=[。！？!?\n])/);
  const kept = parts.filter((s) => !isLie(s));
  if (kept.length === parts.length) return text;
  // 删句后会残留孤零零的括号/标点行与空括号对，一并扫掉
  const cleaned = kept
    .join("")
    .replace(/[（(【\[]\s*[）)】\]]/g, "")
    .split("\n")
    .filter((line) => !/^[\s\-*·.、,，;；:：!！?？()（）\[\]【】]*$/.test(line))
    .join("\n")
    .trim();
  return (cleaned ? cleaned + "\n" : "") + FS_LIE_NOTE;
}

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

  const call = async () => {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      // 识图模型不走 function calling：带图轮次不塞 tools，避免上游 400
      body: JSON.stringify({ model: provider.model, messages, ...(withImages ? {} : { tools: TOOLS, tool_choice: "auto" }) }),
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

  // 工具循环：最多两轮（模型调工具→拿结果→再调一次兜底）
  for (let round = 0; round < 2; round++) {
    const msg = data.choices?.[0]?.message;
    const calls = msg?.tool_calls;
    if (!calls?.length) {
      return NextResponse.json({
        ok: true, provider: provider.id, model: provider.model,
        reply: sanitizeReply(String(msg?.content ?? "（模型返回空回复）")),
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
      const result = await runTool(fnName, args).catch((e) => ({ error: String(e) }));
      if (fnName === "analyze_contest_integration" && (result as { error?: string })?.error === undefined) {
        integration = result as IntegrationPlan;
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

  const final = data.choices?.[0]?.message;
  return NextResponse.json({
    ok: true, provider: provider.id, model: provider.model,
    reply: sanitizeReply(String(final?.content ?? "（已达工具调用轮次上限，请把需求拆简单一点再问）")),
    tools: toolsCalled,
    integration,
  });
}
