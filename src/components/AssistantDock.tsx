"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Provider = { id: string; label: string; model: string; note: string; keyFile: string; hasKey: boolean };
type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; args: unknown }[]; degraded?: boolean };

const QUICK = [
  "现在工作台是什么状态？有哪些比赛快到期了？",
  "帮我登记一个新比赛",
  "最近我该推进哪件事？",
];

// 全站常驻的 AI 助手对话卡（M17）：固定右下角、默认展开常显。
// 逻辑与原 /assistant 页一致，改为 dock 形态挂进全局 layout，任何页面随手可问。
export function AssistantDock() {
  const [open, setOpen] = useState(true);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("glm");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy, open]);

  // 首页 Hero「问问 AI 助手」按钮通过全局事件唤起：展开 + 聚焦输入框
  useEffect(() => {
    const onOpen = () => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); };
    window.addEventListener("open-assistant", onOpen);
    return () => window.removeEventListener("open-assistant", onOpen);
  }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          messages: next.filter((m) => !m.degraded).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await res.json();
      setMsgs([...next, {
        role: "assistant",
        content: j.reply ?? j.error ?? "（无回复）",
        tools: j.tools,
        degraded: !!j.degraded,
      }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `网络错误：${String(e)}`, degraded: true }]);
    } finally {
      setBusy(false);
    }
  }

  const cur = providers.find((p) => p.id === provider);

  // 收起态：右下角一颗药丸按钮
  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-medium text-white shadow-lg hover:opacity-90">
        🤖 问 AI 助手
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[min(72vh,40rem)] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-semibold">AI 助手</span>
        </div>
        <div className="flex items-center gap-1.5">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}
            className="max-w-[8.5rem] rounded-md border bg-white px-1.5 py-1 text-xs">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.hasKey ? "🟢" : "⚪"} {p.label.split("（")[0]}</option>
            ))}
          </select>
          <button onClick={() => setOpen(false)} title="收起（不丢对话）"
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-200">−</button>
        </div>
      </div>

      {cur && !cur.hasKey && (
        <div className="border-b bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
          当前模型未配 key。<b>{cur.note}</b> —— 拿到后存为一行到 <code className="rounded bg-white px-1">{cur.keyFile}</code>，已配 key 的模型可下拉切换。
        </div>
      )}

      {/* 消息区 */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-3xl">👋</div>
            <p className="text-xs text-slate-400">我在呢，任何页面都能喊我。点一下常用开场直接问：</p>
            <div className="flex flex-col gap-1.5">
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
                    <span key={k} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500">
                      🔧 {t.name === "query_status" ? "查询了工作台状态" : t.name === "add_contest" ? `登记比赛「${(t.args as { name?: string })?.name ?? "?"}」` : t.name}
                    </span>
                  ))}
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
      <div className="flex gap-1.5 border-t bg-slate-50 p-2">
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-xs"
          placeholder={busy ? "回复中…" : "问工作台的事，如「帮我登记比赛：XXX 大赛，7月20日截止」"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        <button onClick={() => send(input)} disabled={busy || !input.trim()}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">
          发送
        </button>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} title="清空对话（不影响台账）"
            className="rounded-lg border bg-white px-2 py-2 text-xs text-slate-500 hover:bg-slate-100">🧹</button>
        )}
      </div>
    </div>
  );
}
