"use client";

import { useCallback, useEffect, useState } from "react";

type ConnectionAccount = {
  id: number;
  connectionId: number;
  label: string;
  launchCommand: string;
  notes: string;
};

type Connection = {
  id: number;
  toolName: string;
  category: string;
  entryUrl: string;
  accountNotes: string;
  credentialRef: string;
  launchCommand: string;
  status: string;
  tags: string;
  notes: string;
  lastUsedAt: string | null;
  accounts: ConnectionAccount[];
};

const CATEGORY_LABELS: Record<string, string> = {
  coding: "AI 编程",
  agent: "智能体平台",
  assistant: "AI 助手",
  work: "办公工作台",
  knowledge: "知识库/资产",
  platform: "开发平台",
  tool: "效率工具",
  vault: "凭据库",
  other: "其他",
};

const CATEGORY_COLORS: Record<string, string> = {
  coding: "bg-blue-50 text-blue-700",
  agent: "bg-purple-50 text-purple-700",
  assistant: "bg-sky-50 text-sky-700",
  work: "bg-emerald-50 text-emerald-700",
  knowledge: "bg-amber-100 text-amber-800",
  platform: "bg-slate-100 text-slate-600",
  tool: "bg-slate-100 text-slate-600",
  vault: "bg-amber-50 text-amber-700",
  other: "bg-slate-100 text-slate-600",
};

const emptyForm = {
  toolName: "",
  category: "other",
  entryUrl: "",
  accountNotes: "",
  credentialRef: "",
  launchCommand: "",
  tags: "",
  notes: "",
};

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [acctOpen, setAcctOpen] = useState<number | null>(null);
  const [acctForm, setAcctForm] = useState({ label: "", cmd: "" });

  const load = useCallback(() => {
    fetch("/api/connections").then((r) => r.json()).then(setConnections);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createConnection() {
    setError("");
    if (!form.toolName.trim()) { setError("工具名称是必填项"); return; }
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) { setError((await res.json()).error ?? "创建失败"); return; }
    setForm(emptyForm); setShowForm(false); load();
  }

  async function touch(id: number) {
    await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touch: true }),
    });
    load();
  }

  async function launchConnection(c: Connection) {
    const res = await fetch(`/api/connections/${c.id}/launch`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "启动失败" }));
      window.alert(j.error ?? "启动失败");
      return;
    }
    load();
  }

  async function editLaunch(c: Connection) {
    const v = window.prompt(
      `「${c.toolName}」的启动命令（VS Code 系可用 --user-data-dir 多账号多开；留空则清除；不含密码）`,
      c.launchCommand
    );
    if (v === null) return;
    await fetch(`/api/connections/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ launchCommand: v }),
    });
    load();
  }

  async function openCredential(c: Connection) {
    const res = await fetch(`/api/connections/${c.id}/credential-open`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "打开失败" }));
      window.alert(j.error ?? "打开失败");
    }
  }

  function toggleAcct(c: Connection) {
    setAcctForm({ label: "", cmd: "" });
    setAcctOpen((cur) => (cur === c.id ? null : c.id));
  }

  async function launchAccount(a: ConnectionAccount) {
    const res = await fetch(`/api/accounts/${a.id}/launch`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "启动失败" }));
      window.alert(j.error ?? "启动失败");
      return;
    }
    load();
  }

  async function deleteAccount(a: ConnectionAccount) {
    if (!window.confirm(`确认删除账号条目「${a.label}」？`)) return;
    await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    load();
  }

  async function addAccount(c: Connection) {
    if (!acctForm.label.trim()) { setError("账号名称是必填项"); return; }
    setError("");
    const res = await fetch(`/api/connections/${c.id}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: acctForm.label, launchCommand: acctForm.cmd }),
    });
    if (!res.ok) { setError((await res.json()).error ?? "添加失败"); return; }
    setAcctForm({ label: "", cmd: "" });
    load();
  }

  async function removeConnection(id: number, name: string) {
    if (!window.confirm(`确认删除「${name}」的连接卡片？`)) return;
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    load();
  }

  function openEntry(c: Connection) {
    if (!c.entryUrl) {
      window.alert(`${c.toolName} 无固定入口 URL。${c.accountNotes ? "\n" + c.accountNotes : ""}`);
      return;
    }
    window.open(c.entryUrl, "_blank");
    touch(c.id);
  }

  const shown = filter === "all" ? connections : connections.filter((c) => c.category === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">连接中心</h1>
          <p className="mt-1 text-sm text-slate-500">
            共 {connections.length} 个工具 · 只存账号备注与凭据引用，<span className="font-medium text-slate-700">绝不存密码</span>
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? "收起表单" : "+ 添加工具"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="工具名称 *"
              value={form.toolName} onChange={(e) => setForm({ ...form, toolName: e.target.value })} />
            <select className="rounded-lg border px-3 py-2 text-sm"
              value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
            <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="入口 URL（可空）"
              value={form.entryUrl} onChange={(e) => setForm({ ...form, entryUrl: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="账号备注（有哪些账号/怎么切换，不含密码）"
              value={form.accountNotes} onChange={(e) => setForm({ ...form, accountNotes: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="凭据存放引用（本地文件路径或 vault 条目，不是密码本身）"
              value={form.credentialRef} onChange={(e) => setForm({ ...form, credentialRef: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="启动命令（可选，桌面工具多账号多开，如 &quot;E:\xx\TRAE.exe&quot; --user-data-dir=E:\Profiles\号2，不含密码）"
              value={form.launchCommand} onChange={(e) => setForm({ ...form, launchCommand: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="标签（逗号分隔）"
              value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            <input className="rounded-lg border px-3 py-2 text-sm" placeholder="备注"
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          <button onClick={createConnection}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">
            保存
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {[{ k: "all", v: "全部" }, ...Object.entries(CATEGORY_LABELS).map(([k, v]) => ({ k, v }))].map((f) => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`rounded-full px-3 py-1 text-xs ${filter === f.k ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}>
            {f.v}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <div key={c.id} className="flex flex-col rounded-xl border bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.toolName}</div>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS.other}`}>
                  {CATEGORY_LABELS[c.category] ?? c.category}
                </span>
              </div>
              <button onClick={() => removeConnection(c.id, c.toolName)}
                className="shrink-0 text-xs text-slate-300 hover:text-red-500">删</button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-slate-500">{c.accountNotes || "—"}</p>
            {c.credentialRef && (
              <button onClick={() => openCredential(c)} title={`定位：${c.credentialRef}`}
                className="mt-1 block max-w-full truncate text-left text-[11px] text-slate-400 hover:text-blue-600 hover:underline">
                凭据引用：{c.credentialRef}（点击定位 ↗）
              </button>
            )}
            {c.tags && <p className="mt-1 text-[11px] text-slate-400">{c.tags}</p>}
            {acctOpen === c.id && (
              <div className="mt-2 rounded-lg border bg-slate-50 p-2">
                <div className="text-[11px] font-medium text-slate-500">账号条目（一号一命令，点 ▶ 启动该号）</div>
                <div className="mt-0.5 text-[10px] text-slate-400">同一号重复点 ▶ 只会聚焦已开窗口；长期不用的号登录态可能过期，重新登录一次即可。</div>
                {c.accounts.length === 0 && <div className="mt-1 text-[11px] text-slate-400">暂无账号，先在下面添加</div>}
                {c.accounts.map((a) => (
                  <div key={a.id} className="mt-1 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs" title={a.launchCommand}>{a.label}</span>
                    <button onClick={() => launchAccount(a)}
                      className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-blue-700">▶</button>
                    <button onClick={() => deleteAccount(a)}
                      className="text-[10px] text-slate-300 hover:text-red-500">删</button>
                  </div>
                ))}
                <div className="mt-2 flex gap-1.5">
                  <input className="min-w-0 flex-1 rounded border px-2 py-1 text-xs" placeholder="账号名称 *"
                    value={acctForm.label} onChange={(e) => setAcctForm({ ...acctForm, label: e.target.value })} />
                  <input className="min-w-0 flex-[2] rounded border px-2 py-1 text-xs" placeholder="启动命令（如 &quot;exe路径&quot; --user-data-dir=目录）"
                    value={acctForm.cmd} onChange={(e) => setAcctForm({ ...acctForm, cmd: e.target.value })} />
                  <button onClick={() => addAccount(c)}
                    className="shrink-0 rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-700">添加</button>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between pt-2">
              <span className="text-[10px] text-slate-300">
                {c.lastUsedAt ? `使用过 ${new Date(c.lastUsedAt).toLocaleDateString("zh-CN")}` : "未使用"}
              </span>
              <div className="flex items-center gap-1.5">
                {c.launchCommand && (
                  <button onClick={() => launchConnection(c)}
                    className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">
                    ▶ 启动
                  </button>
                )}
                <button onClick={() => openEntry(c)}
                  className="rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50">
                  {c.entryUrl ? "打开 ↗" : "说明"}
                </button>
                <button onClick={() => toggleAcct(c)}
                  title="卡内多账号切换"
                  className={`rounded-md border px-2 py-1 text-xs ${acctOpen === c.id ? "border-blue-400 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}>
                  账号 {c.accounts.length} {acctOpen === c.id ? "▴" : "▾"}
                </button>
                <button onClick={() => editLaunch(c)} title="编辑默认启动命令"
                  className="rounded-md border px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600">⚙</button>
              </div>
            </div>
          </div>
        ))}
        {shown.length === 0 && (
          <div className="col-span-full rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-400">
            没有符合条件的工具
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        安全设计：本表无密码字段。密码与 API key 请存入 Vaultwarden 或本地凭据文件，此处只登记「去哪里找」。
      </p>
    </div>
  );
}
