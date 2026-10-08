"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntegrationPlan } from "@/lib/contest-integration";

type Provider = { id: string; label: string; model: string; note: string; keyFile: string; hasKey: boolean; vision?: boolean };
type GenMeta = { contestId: number; deliverableName: string; stage: string };
type Integrated = { contestId: number; action: string; delivAdded: number; noteAdded: number };
type Attachment = { name: string; type: "text" | "image"; content: string; dataUrl?: string; size: number };
// 发给 /api/assistant/chat 的线格式：本轮用户消息额外携带附件图片（服务端拼成多模态 content）
type WireMsg = { role: string; content: string; images?: { name: string; dataUrl?: string }[] };
type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; args: unknown }[]; degraded?: boolean; meta?: GenMeta; registered?: boolean; integration?: IntegrationPlan; integrated?: Integrated; attachments?: Attachment[] };

const QUICK = [
  "现在工作台是什么状态？有哪些比赛快到期了？",
  "帮我登记一个新比赛",
  "融入新比赛：我把官网资讯粘贴给你（下条消息发资料）",
  "最近我该推进哪件事？",
];

// 附件大小可读：不足 1KB 不能显示成「0KB」
const fmtSize = (n: number) =>
  n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;

// 全站常驻的 AI 助手（M17 综合布局版）：作为工作区一栏，而非悬浮遮罩。
// 宽屏(lg+)固定在右侧成独立一栏（sticky 全高，内容再长也并排不重叠）；
// 窄屏落到主内容下方，仍在文档流内，绝不遮挡卡片。
export function AssistantDock({ width = 360 }: { width?: number }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("glm");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadProviders = useCallback(() => {
    fetch("/api/assistant/providers").then((r) => r.json()).then((ps: Provider[]) => {
      setProviders(ps);
      const firstReady = ps.find((p) => p.hasKey);
      setProvider((cur) => (ps.find((p) => p.id === cur)?.hasKey ? cur : firstReady?.id ?? cur));
    });
  }, []);
  useEffect(() => { loadProviders(); }, [loadProviders]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, busy]);

  // 首页 Hero「问问 AI 助手」按钮：滚动到本栏并聚焦输入框
  useEffect(() => {
    const onOpen = () => {
      asideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => inputRef.current?.focus(), 120);
    };
    window.addEventListener("open-assistant", onOpen);
    return () => window.removeEventListener("open-assistant", onOpen);
  }, []);

  // 始终指向最新 send，供只订阅一次的全局事件调用（避免陈旧闭包丢 msgs/busy）
  const sendRef = useRef<(t: string, m?: GenMeta) => void>(() => {});

  // M30 Nudge「助手帮你写」：工作流页 dispatch assistant-generate → 自动滚动、发送、携带登记元信息
  useEffect(() => {
    const onGenerate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { prompt: string; meta: GenMeta };
      if (!detail?.prompt) return;
      asideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => inputRef.current?.focus(), 120);
      sendRef.current(detail.prompt, detail.meta);
    };
    window.addEventListener("assistant-generate", onGenerate);
    return () => window.removeEventListener("assistant-generate", onGenerate);
  }, []);

  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const next: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 3)) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/assistant/upload", { method: "POST", body: fd });
        const j = await res.json();
        if (res.ok && j.ok) {
          next.push({ name: j.name, type: j.type, content: j.content, dataUrl: j.dataUrl, size: j.size });
        } else {
          setMsgs((prev) => [...prev, { role: "assistant", content: `⚠ 附件「${f.name}」读取失败：${j.error ?? res.status}`, degraded: true }]);
        }
      } catch (e) {
        setMsgs((prev) => [...prev, { role: "assistant", content: `⚠ 附件「${f.name}」上传异常：${String(e)}`, degraded: true }]);
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
    // 图片附件只有识图模型能吃：当前模型不支持时，有识图 key 就自动切过去，没有就明确提示（degraded 不进对话历史）
    if (next.some((a) => a.type === "image")) {
      const cur = providers.find((p) => p.id === provider);
      if (!cur?.vision) {
        const alt = providers.find((p) => p.vision && p.hasKey);
        if (alt) {
          setProvider(alt.id);
          setMsgs((prev) => [...prev, { role: "assistant", content: `🖼 图片附件需要识图模型，已自动切换到「${alt.label}」（该模型不走工具调用）`, degraded: true }]);
        } else {
          setMsgs((prev) => [...prev, { role: "assistant", content: "⚠ 当前模型不识别图片。文本附件照常分析；图片请下拉切换到带「识图」的模型后再发送。", degraded: true }]);
        }
      }
    }
    setUploading(false);
    inputRef.current?.focus();
  }

  async function send(text: string, meta?: GenMeta) {
    const q = text.trim();
    const atts = attachments;
    if ((!q && atts.length === 0) || busy) return;
    setBusy(true);
    setInput("");
    setAttachments([]);
    // 用户消息展示：文本 + 附件摘要
    const attSummary = atts.map((a) => `📎 ${a.name}（${a.type === "image" ? "图片" : "文本"} ${fmtSize(a.size)}）`).join("\n");
    const display = (atts.length ? attSummary + (q ? "\n" : "") : "") + q;
    const next: Msg[] = [...msgs, { role: "user", content: display, attachments: atts }];
    setMsgs(next);
    // 附件内容拼入发给 LLM 的文本：文本文件内联，图片走 image_url（仅识图模型）
    const attText = atts.filter((a) => a.type === "text").map((a) => `【附件：${a.name}】\n${a.content}\n【附件结束】`).join("\n\n");
    const llmText = (attText ? attText + "\n\n" : "") + (q || "请分析附件内容");
    const imageAtts = atts.filter((a) => a.type === "image").map((a) => ({ name: a.name, dataUrl: a.dataUrl }));
    // 历史过滤掉降级提示后，最后一条必定是刚 push 的本轮用户消息
    const hist: WireMsg[] = next.filter((m) => !m.degraded).map((m) => ({ role: m.role, content: m.content }));
    if (hist.length > 0 && hist[hist.length - 1].role === "user") {
      hist[hist.length - 1] = { role: "user", content: llmText, images: imageAtts };
    }
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, messages: hist }),
      });
      const j = await res.json();
      setMsgs([...next, {
        role: "assistant",
        content: j.reply ?? j.error ?? "（无回复）",
        tools: j.tools,
        degraded: !!j.degraded,
        meta,
        integration: j.integration ?? undefined,
      }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `网络错误：${String(e)}`, degraded: true, meta }]);
    } finally {
      setBusy(false);
    }
  }
  sendRef.current = send;

  // 「确认登记」：把助手直出产物登记回交付物清单（done + path=assistant-inline）
  async function registerGenerated(m: Msg, idx: number) {
    if (!m.meta) return;
    const res = await fetch(`/api/contests/${m.meta.contestId}/deliverables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: m.meta.deliverableName, stage: m.meta.stage, path: "assistant-inline", done: true }),
    });
    if (!res.ok) return;
    setMsgs((prev) => prev.map((x, i) => (i === idx ? { ...x, registered: true } : x)));
  }

  // 「确认融入」：用户看过预览后一按 → /api/integrate 跨板块事务落库（方案甲的确认门）
  const [integrating, setIntegrating] = useState<number | null>(null);
  async function confirmIntegrate(m: Msg, idx: number) {
    if (!m.integration || integrating !== null) return;
    setIntegrating(idx);
    try {
      const res = await fetch("/api/integrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: m.integration }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setMsgs((prev) => prev.map((x, i) => (i === idx ? { ...x, integrated: { contestId: j.contestId, action: j.action, delivAdded: j.delivAdded, noteAdded: j.noteAdded } } : x)));
        // 广播：日历/首页待办即时刷新提醒（复用 M31 事件）；比赛列表切页挂载即取到新赛
        window.dispatchEvent(new Event("workbench-notes-changed"));
        window.dispatchEvent(new Event("workbench-contests-changed"));
      } else {
        setMsgs((prev) => prev.map((x, i) => (i === idx ? { ...x, content: x.content + `\n⚠ 融入失败：${j.error ?? res.status}` } : x)));
      }
    } catch (e) {
      setMsgs((prev) => prev.map((x, i) => (i === idx ? { ...x, content: x.content + `\n⚠ 融入失败：${String(e)}` } : x)));
    } finally {
      setIntegrating(null);
    }
  }

  const cur = providers.find((p) => p.id === provider);

  return (
    <aside
      ref={asideRef}
      style={{ ["--dw" as string]: `${width}px` } as React.CSSProperties}
      className="card-fluid flex w-full shrink-0 flex-col border-t bg-white lg:sticky lg:top-0 lg:h-screen lg:w-[var(--dw)] lg:border-t-0 lg:border-l"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-semibold">AI 助手</span>
        </div>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}
          className="max-w-[10rem] rounded-md border bg-white px-2 py-1 text-xs">
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.hasKey ? "🟢" : "⚪"} {p.label.split("（")[0]}</option>
          ))}
        </select>
      </div>

      {cur && !cur.hasKey && (
        <div className="border-b bg-amber-50 px-4 py-2 text-xs leading-snug text-amber-800">
          当前模型未配 key。<b>{cur.note}</b> —— 拿到后存为一行到 <code className="rounded bg-white px-1">{cur.keyFile}</code>，已配 key 的模型可下拉切换。
        </div>
      )}

      {/* 消息区：宽屏撑满栏高独立滚动；窄屏限高避免过长 */}
      <div className="h-[45vh] flex-1 space-y-3 overflow-y-auto px-4 py-3 lg:h-auto">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-3xl">👋</div>
            <p className="text-xs text-slate-400">我在呢，任何页面都能喊我。点一下常用开场直接问：</p>
            <div className="flex w-full flex-col gap-1.5 px-2">
              {QUICK.map((q) => (
                <button key={q} onClick={() => send(q)}
                  className="rounded-lg border bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-600">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs ${
              m.role === "user"
                ? "bg-blue-600 text-white"
                : m.degraded
                  ? "border border-amber-200 bg-amber-50 text-amber-800"
                  : "bg-slate-100 text-slate-800"
            }`}>
              {m.content}
              {m.tools && m.tools.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-200 pt-1.5">
                  {m.tools.map((t, k) => (
                    <span key={k} className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-500">
                      🔧 {t.name === "query_status" ? "查询了工作台状态" : t.name === "add_contest" ? `登记比赛「${(t.args as { name?: string })?.name ?? "?"}」` : t.name === "analyze_contest_integration" ? "生成了融入方案预览" : t.name}
                    </span>
                  ))}
                </div>
              )}
              {m.integration && !m.degraded && (
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/60 p-2 text-xs">
                  <div className="font-semibold text-blue-800">🧩 融入方案预览 · {m.integration.contest.name}</div>
                  <div className="mt-1 text-slate-600">
                    {m.integration.match.action === "update"
                      ? <>对齐更新到已有比赛「{m.integration.match.matchedName}」#{m.integration.match.contestId}</>
                      : <>新建比赛</>}
                    {m.integration.contest.deadline ? ` · 截止 ${m.integration.contest.deadline}` : ""}
                  </div>
                  {m.integration.warnings.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-amber-700">
                      {m.integration.warnings.map((w, k) => <li key={k}>{w}</li>)}
                    </ul>
                  )}
                  <div className="mt-1 text-slate-500">
                    材料 {m.integration.deliverables.length} 项{m.integration.deliverableSource === "sop-fallback" ? "（标准手册底稿）" : ""} · 提醒 {m.integration.reminders.length} 条 · 里程碑 {m.integration.milestones.length} 个
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-blue-600">展开明细</summary>
                    <ul className="mt-1 space-y-0.5 pl-4 text-slate-600">
                      {m.integration.deliverables.map((d, k) => <li key={"d" + k}>📦 {d.name}{d.standard && d.standard !== "待定" ? `（${d.standard}）` : ""}</li>)}
                      {m.integration.reminders.map((r, k) => <li key={"r" + k}>🔔 {r.date} {r.text}</li>)}
                    </ul>
                  </details>
                  {m.integrated ? (
                    <div className="mt-1.5 font-medium text-emerald-700">✓ 已融入：{m.integrated.action === "update" ? "对齐更新" : "新建"}比赛 #{m.integrated.contestId}，材料 {m.integrated.delivAdded} 项、提醒 {m.integrated.noteAdded} 条</div>
                  ) : (
                    <button
                      onClick={() => confirmIntegrate(m, i)}
                      disabled={integrating !== null}
                      className="mt-1.5 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {integrating === i ? "融入中…" : "✓ 确认融入"}
                    </button>
                  )}
                </div>
              )}
              {m.meta && !m.degraded && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2">
                  {m.registered ? (
                    <span className="text-xs font-medium text-emerald-600">✓ 已登记「{m.meta.deliverableName}」到交付物</span>
                  ) : (
                    <>
                      <button
                        onClick={() => registerGenerated(m, i)}
                        className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        ✓ 确认登记
                      </button>
                      <button
                        onClick={() => { setInput("对刚才的内容做如下修改："); inputRef.current?.focus(); }}
                        className="rounded border bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        ✏ 再改改
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs text-slate-400">
              <span className="animate-pulse">思考中…（调用 {cur?.model ?? provider}）</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="border-t bg-slate-50 p-2.5">
        {attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attachments.map((a, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs text-slate-600">
                {a.type === "image" ? "🖼" : "📄"} {a.name.length > 14 ? a.name.slice(0, 12) + "…" : a.name}
                <button onClick={() => setAttachments((prev) => prev.filter((_, k) => k !== i))} className="text-slate-400 hover:text-red-500">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.csv,.json,.tsv,.log,.yaml,.yml,.xml,.html,.png,.jpg,.jpeg,.gif,.webp"
            multiple
            className="hidden"
            onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy || uploading}
            title="上传文件/图片供 AI 分析"
            className="rounded-lg border bg-white px-2.5 py-2 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            {uploading ? "读取中…" : "📎"}
          </button>
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-xs"
            placeholder={busy ? "回复中…" : "问工作台的事，或点 📎 上传文件/截图让 AI 分析"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          />
          <button onClick={() => send(input)} disabled={busy || (!input.trim() && attachments.length === 0)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            发送
          </button>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} title="清空对话（不影响台账）"
            className="rounded-lg border bg-white px-2 py-2 text-xs text-slate-500 hover:bg-slate-100">🧹</button>
        )}
        </div>
      </div>
    </aside>
  );
}
