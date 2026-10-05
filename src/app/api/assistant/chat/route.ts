import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { contestJSON } from "@/lib/serializers";
import { getProvider, readKey, ASSISTANT_PROVIDERS } from "@/lib/assistant";

/**
 * AI 对话助手（M17）：POST /api/assistant/chat
 * - 多家免费 LLM（OpenAI 兼容）可切换，key 只从本地 credentials 文件读（红线①）
 * - 工具调用查状态/新增比赛：写操作走与网页端同一条 Prisma 事务 + 流水（红线⑤单一权威）
 * - 无 key / 调用失败：降级返回可读提示，不崩（多重保障：一家不行 UI 上换下一家）
 */

const SYSTEM_PROMPT = `你是「杨杨的AI比赛专用工作台」内置的AI助手，帮助用户协调比赛创作工作。
你可以调用工具：query_status 查询工作台状态（项目/比赛/工具卡数量、临近截止的比赛），add_contest 登记新比赛。
铁律：绝不编造事实。用户没说的日期、主办方、链接，一律留空并说明「未提供，之后可补」；日期必须是用户明确给出的（红线：不脑补日期）。
登记比赛前先复述你理解的信息；如缺少名称之外的关键项，直接登记空字段并在回复里说明。
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
      name: "add_contest",
      description: "登记一个新比赛到工作台台账",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "比赛名称（必填）" },
          organizer: { type: "string", description: "主办方；用户没说就留空" },
          track: { type: "string", description: "赛道/方向；没说留空" },
          startDate: { type: "string", description: "开始日期 YYYY-MM-DD；用户明确说了才填，绝不猜" },
          deadline: { type: "string", description: "截止日期 YYYY-MM-DD；用户明确说了才填，绝不猜" },
          submitLink: { type: "string", description: "报名/提交链接；没说留空" },
          notes: { type: "string", description: "备注" },
        },
        required: ["name"],
      },
    },
  },
];

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
  if (name === "add_contest") {
    const ctName = String(args.name ?? "").trim();
    if (!ctName) return { error: "比赛名称缺失，无法登记" };
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.contest.create({
        data: {
          name: ctName,
          organizer: String(args.organizer ?? ""),
          track: String(args.track ?? ""),
          startDate: String(args.startDate ?? ""),
          deadline: String(args.deadline ?? ""),
          status: "research",
          submitLink: String(args.submitLink ?? ""),
          notes: String(args.notes ?? ""),
        },
      });
      await logEvent(tx, "contest", c.id, "create", null, contestJSON(c));
      return c;
    });
    const missing = ["organizer", "startDate", "deadline", "submitLink"].filter((k) => !String(args[k] ?? "").trim());
    return { ok: true, contest: contestJSON(created), missingFields: missing };
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
      });
    }
    messages.push(msg);
    for (const tc of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* 容错：按空参数处理 */ }
      const fnName = String(tc.function?.name ?? "");
      toolsCalled.push({ name: fnName, args });
      const result = await runTool(fnName, args).catch((e) => ({ error: String(e) }));
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
  });
}
