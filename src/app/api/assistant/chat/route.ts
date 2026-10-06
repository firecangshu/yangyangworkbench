import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider, readKey, ASSISTANT_PROVIDERS } from "@/lib/assistant";
import { buildIntegrationPlan, type ExtractedContest, type IntegrationPlan } from "@/lib/contest-integration";

/**
 * AI 对话助手（M17）：POST /api/assistant/chat
 * - 多家免费 LLM（OpenAI 兼容）可切换，key 只从本地 credentials 文件读（红线①）
 * - 工具调用查状态/新增比赛：写操作走与网页端同一条 Prisma 事务 + 流水（红线⑤单一权威）
 * - 无 key / 调用失败：降级返回可读提示，不崩（多重保障：一家不行 UI 上换下一家）
 */

const SYSTEM_PROMPT = `你是「杨杨的AI比赛专用工作台」内置的AI助手，帮助用户协调比赛创作工作。
你可以调用工具：query_status 查询工作台状态（项目/比赛/工具卡数量、临近截止的比赛），analyze_contest_integration 赛事融入分析（新比赛入场的唯一入口）。
当用户要登记/融入/规划任何新比赛时（无论一句话还是粘贴整段官网资讯）：一律先调用 analyze_contest_integration 生成「融入方案预览」——它会把资讯抽成结构化字段、去重比对现有比赛、拆解材料清单与日历提醒，供用户逐项核对；该工具只读，绝不写库。只有用户在预览卡上点「确认融入」后，系统才会真正落库联动各板块。严禁绕过确认门直接写库或声称已录入。
铁律：绝不编造事实。用户没说的日期、主办方、链接，一律留空（会标「待定」）；日期必须是用户明确给出的（红线：不脑补日期）。
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

type ChatMessage = { role: string; content: string; [k: string]: unknown };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const providerId = String(body.provider ?? "glm");
  const provider = getProvider(providerId) ?? ASSISTANT_PROVIDERS[0];
  const history = Array.isArray(body.messages) ? (body.messages as ChatMessage[]).slice(-20) : [];
  const userMsgs = history.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return NextResponse.json({ error: "没有用户消息" }, { status: 400 });

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

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
  const toolsCalled: { name: string; args: unknown }[] = [];
  let integration: IntegrationPlan | null = null;

  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: provider.model, messages, tool_choice: "auto", ...payload }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
    return res.json();
  };

  let data;
  try {
    data = await call({ tools: TOOLS });
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
        reply: String(msg?.content ?? "（模型返回空回复）"),
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
      data = await call({ tools: TOOLS });
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
    reply: String(final?.content ?? "（已达工具调用轮次上限，请把需求拆简单一点再问）"),
    tools: toolsCalled,
    integration,
  });
}
