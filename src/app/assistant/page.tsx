"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Provider = { id: string; label: string; model: string; note: string; keyFile: string; hasKey: boolean };
type Msg = { role: "user" | "assistant"; content: string; tools?: { name: string; args: unknown }[]; degraded?: boolean };

const QUICK = [
  "现在工作台是什么状态？有哪些比赛快到期了？",
  "帮我登记一个新比赛",
  "最近我该推进哪件事？",
];

export default function AssistantPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("glm");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadProviders = useCallback(() => {
    fetch("/api/assistant/providers").then((r) => r.json()).then((ps: Provider[]) => {
      setProviders(ps);
      // 默认选第一个已配 key 的；全没配则留在 glm 显示引导
      const firstReady = ps.find((p) => p.hasKey);
      setProvider((cur) => (ps.find((p) => p.id === cur)?.hasKey ? cur : firstReady?.id ?? cur));
    });
  }, []);
  useEffect(() => { loadProviders(); }, [loadProviders]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

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

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">AI 助手</h1>
          <p className="mt-1 text-sm text-slate-500">问状态、登记比赛、协调工作 · key 只存本地文件，绝不入库</p>
        </div>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border bg-white px-3 py-2 text-sm">
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.hasKey ? "🟢" : "⚪"} {p.label}
            </option>
          ))}
        </select>
      </div>

      {cur && !cur.hasKey && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          当前模型未配置 API key。<b>{cur.note}</b> —— 拿到 key 后保存为一行文本到工作台目录的 <code className="rounded bg-white px-1">{cur.keyFile}</code>。
          已配好 key 的模型可直接下拉切换（多重保障）。
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border bg-white p-4">
        {msgs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-4xl">👋</div>
            <p className="text-sm text-slate-400">我在呢。下面是常用开场，点一下就能问：</p>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK.map((q) => (
                <button key={q} onClick={() => send(q)}
                  className="rounded-full border bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-600">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
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
            <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-400">
              <span className="animate-pulse">思考中…（调用 {cur?.model ?? provider}，首条可能要等几秒）</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-xl border bg-white px-4 py-3 text-sm"
          placeholder={busy ? "回复中…" : "问我工作台的事，比如「帮我登记比赛：XXX 大赛，7月20日截止」"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        <button onClick={() => send(input)} disabled={busy || !input.trim()}
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
          发送
        </button>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} title="清空对话（不影响台账）"
            className="rounded-xl border bg-white px-3 py-3 text-sm text-slate-500 hover:bg-slate-50">🧹</button>
        )}
      </div>
    </div>
  );
}
