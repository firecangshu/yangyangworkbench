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

type Scene = {
  id: number;
  name: string;
  notes: string;
  items: { id: number; sceneId: number; kind: string; refId: number; sortOrder: number }[];
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

/**
 * 切号自检的展示映射（M36.1）：状态来自 /api/accounts/:id/probe，只看磁盘事实。
 * 存疑类状态一律说“未必”、不说“失败”——程序把请求交给已开着的窗口时也不会写盘，那是正常行为。
 */
const PROBE_ICON: Record<string, string> = {
  checking: "⋯",
  written: "✅",
  stale: "⚠️",
  empty: "⚠️",
  missing: "⚠️",
  none: "—",
};
const PROBE_TIP: Record<string, string> = {
  checking: "正在看这个号的登录空间目录有没有被写入…",
  written: "这个号的登录空间刚刚被写过：切号是真生效了",
  stale: "登录空间有历史但本次没动静：该程序可能忽略了这个参数（登录态未必切开），也可能它把请求交给了已经开着的窗口",
  empty: "登录空间目录还是空的：这个程序大概率不认隔离目录的参数，或者压根没启动起来",
  missing: "登录空间目录还不存在：这个号还没真正用它自己的目录启动过",
  none: "这个号是手写命令、没带独立登录空间参数，没法自检",
};

/** 多号登录空间的五条如实边界（悬停在“边界”那行上看） */
const BOUNDARY_TIP =
  "① 一个号只在一个登录空间长期活着：同一个号在两处同时在线，后登录的那份会把先前那份顶掉（刷新令牌轮转）。\n" +
  "② 第三方授权（Google/GitHub 之类）点登录时可能跳到你主浏览器窗口，跳回来就对不上号；这类平台优先用该号目录里已登录的入口直接进。\n" +
  "③ 不要往号自己的命令里加自动化参数；工作台只靠 --user-data-dir 约定隔离数据目录，额外参数容易把启动搞坏。\n" +
  "④ IP 与设备指纹这一层我们不隔离：多个号在同一台机器、同一个网络里仍是同源。真要防关联请用专业方案，工作台不做。\n" +
  "⑤ 登录空间根目录默认 E:/AI工具Profile（没 E 盘退到 LOCALAPPDATA），可用环境变量 WORKBENCH_PROFILE_ROOT 改到本地固定盘；E 盘若是同步盘/移动盘，登录态等于被同步出去了。";

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
  const [acctHint, setAcctHint] = useState("");
  const [acctAdv, setAcctAdv] = useState(false);
  const [acctProbe, setAcctProbe] = useState<Record<string, string>>({}); // 切号自检结果（M36.1）
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneEdit, setSceneEdit] = useState<{ id: number | null; name: string; items: string[] } | null>(null);
  const [rotateCursor, setRotateCursor] = useState<Record<number, number>>({});

  const load = useCallback(() => {
    fetch("/api/connections").then((r) => r.json()).then(setConnections);
    fetch("/api/scenes").then((r) => r.json()).then(setScenes);
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
    setAcctHint("");
    setAcctAdv(false);
    setError("");
    setAcctOpen((cur) => (cur === c.id ? null : c.id));
  }

  /**
   * 切号自检（M36.1）：启动后看那个登录空间目录有没有被写过。
   * 为什么必须自检：自管凭据的桌面应用会直接忽略 --user-data-dir，号名换了、目录换了，
   * 点进去还是同一个账号，而且界面上一切正常——这种假成功比报错危险。
   */
  async function probeAccount(id: number) {
    const res = await fetch(`/api/accounts/${id}/probe`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setAcctProbe((prev) => ({ ...prev, [id]: "none" })); return; }
    setAcctProbe((prev) => ({ ...prev, [id]: j.verifiable ? j.state : "none" }));
  }

  async function launchAccount(a: ConnectionAccount) {
    setError("");
    setAcctHint("");
    const res = await fetch(`/api/accounts/${a.id}/launch`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "启动失败" }));
      window.alert(j.error ?? "启动失败");
      return;
    }
    setAcctProbe((prev) => ({ ...prev, [a.id]: "checking" }));
    // 程序写盘有前有后，分两次看：4s 抢快，12s 兼顾慢启动
    setTimeout(() => void probeAccount(a.id), 4000);
    setTimeout(() => void probeAccount(a.id), 12000);
    load();
  }

  async function openAccountDir(a: ConnectionAccount) {
    setError("");
    setAcctHint("");
    const res = await fetch(`/api/accounts/${a.id}/folder`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "打开失败"); return; }
    setAcctHint(`已在资源管理器里打开这个号的登录空间：${j.dir}`);
  }

  async function stopAccount(a: ConnectionAccount) {
    if (!window.confirm(`结束「${a.label}」的所有窗口？\n只关这个号自己的进程，你本人开的主窗口不会被动到。`)) return;
    setError("");
    setAcctHint("");
    const res = await fetch(`/api/accounts/${a.id}/stop`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "结束失败"); return; }
    setAcctHint(j.note ?? "已处理");
  }

  /** 删号可选连带清掉登录空间（M36.1）：清与不清由用户选，服务端有防越界护栏 */
  async function deleteAccount(a: ConnectionAccount) {
    if (!window.confirm(`确认删除账号条目「${a.label}」？`)) return;
    const purge = window.confirm(`要连它的登录空间目录一起清掉吗？\n点“确定”：目录一起删，以后得重新登录；\n点“取消”：只删这条号，目录原样留在磁盘上。`);
    const res = await fetch(`/api/accounts/${a.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "删除失败"); return; }
    setAcctHint(
      j.purged
        ? `已删「${a.label}」，登录空间也清干净了：${j.purged}`
        : j.purgeSkipped
          ? `已删「${a.label}」（没清目录：${j.purgeSkipped}）`
          : `已删「${a.label}」。`
    );
    load();
  }

  async function addAccount(c: Connection) {
    if (!acctForm.label.trim()) { setError("账号名称是必填项"); return; }
    setError("");
    setAcctHint("");
    const res = await fetch(`/api/connections/${c.id}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: acctForm.label, launchCommand: acctForm.cmd }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "添加失败"); return; }
    setAcctHint(
      j.auto
        ? `已给「${j.label}」分到独立登录空间：${j.profileDir}\n第一次点开后自己登录一次，以后点 ▶ 就是登录态。`
        : `已按你手写的命令添加「${j.label}」。`
    );
    setAcctForm({ label: "", cmd: "" });
    load();
  }

  /** M36：卡片换了程序路径或入口网址后，重建该号的登录空间命令（不用手打） */
  async function regenAccount(a: ConnectionAccount) {
    setError("");
    setAcctHint("");
    const res = await fetch(`/api/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regen: true }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "重建失败"); return; }
    setAcctHint(`「${j.label}」的登录空间命令已按卡片现状重建：${j.profileDir}`);
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

  /* ---------- M17 启动场景 ---------- */

  // 可启动目标清单：有启动命令的卡 + 卡内有命令的账号
  const launchables = connections.flatMap((c) => [
    ...(c.launchCommand.trim() ? [{ key: `connection:${c.id}`, label: c.toolName }] : []),
    ...c.accounts.filter((a) => a.launchCommand.trim()).map((a) => ({ key: `account:${a.id}`, label: `${c.toolName} · ${a.label}` })),
  ]);
  const launchableLabel = (kind: string, refId: number) =>
    launchables.find((l) => l.key === `${kind}:${refId}`)?.label ?? `${kind}#${refId}`;

  async function fireScene(s: Scene) {
    const res = await fetch(`/api/scenes/${s.id}/fire`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "启动失败" }));
      window.alert(j.error ?? "启动失败");
      return;
    }
    load();
  }

  function editScene(s: Scene) {
    setSceneEdit({ id: s.id, name: s.name, items: s.items.map((it) => `${it.kind}:${it.refId}`) });
  }

  async function deleteScene(s: Scene) {
    if (!window.confirm(`确认删除场景「${s.name}」？（只删台账，不影响程序本身）`)) return;
    await fetch(`/api/scenes/${s.id}`, { method: "DELETE" });
    load();
  }

  async function saveScene() {
    if (!sceneEdit) return;
    if (!sceneEdit.name.trim()) { setError("场景名称是必填项"); return; }
    setError("");
    const body = JSON.stringify({
      name: sceneEdit.name,
      items: sceneEdit.items.map((k) => ({ kind: k.split(":")[0], refId: Number(k.split(":")[1]) })),
    });
    const url = sceneEdit.id ? `/api/scenes/${sceneEdit.id}` : "/api/scenes";
    const res = await fetch(url, { method: sceneEdit.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok) { setError((await res.json()).error ?? "保存失败"); return; }
    setSceneEdit(null);
    load();
  }

  /* ---------- M17 卡内轮切：点一次按顺序拉起下一个有命令的账号，循环 ---- */
  async function rotateNext(c: Connection) {
    const pool = c.accounts.filter((a) => a.launchCommand.trim());
    if (pool.length === 0) { setError(`「${c.toolName}」的账号还没有配启动命令`); return; }
    const idx = ((rotateCursor[c.id] ?? -1) + 1) % pool.length;
    setRotateCursor({ ...rotateCursor, [c.id]: idx });
    const res = await fetch(`/api/accounts/${pool[idx].id}/launch`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: "启动失败" }));
      window.alert(j.error ?? "启动失败");
      return;
    }
    load();
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

      {error && !showForm && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {showForm && (
        <div className="card-fluid rounded-xl border bg-white p-4">
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

      {/* M17 启动场景：一键并行拉起常用组合 */}
      <div className="card-fluid rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">🚀 启动场景（一键并行拉起一组程序+指定账号）</div>
          <button
            onClick={() => setSceneEdit({ id: null, name: "", items: [] })}
            className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50"
          >
            + 新建场景
          </button>
        </div>

        {scenes.length === 0 && !sceneEdit && (
          <p className="mt-2 text-xs text-slate-400">还没有场景。把经常一起开的程序（含指定账号）存成组合，点一下全部拉起。</p>
        )}

        {scenes.length > 0 && (
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
            {scenes.map((s) => (
              <div key={s.id} className="rounded-lg border bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {s.items.map((it) => launchableLabel(it.kind, it.refId)).join(" + ") || "（空场景）"}
                    </div>
                  </div>
                  <button onClick={() => fireScene(s)} title="一键并行启动"
                    className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700">
                    ▶ 启动全部
                  </button>
                </div>
                <div className="mt-2 flex gap-2 text-xs">
                  <button onClick={() => editScene(s)} className="text-slate-400 hover:text-blue-600">编辑</button>
                  <button onClick={() => deleteScene(s)} className="text-slate-400 hover:text-red-500">删除</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {sceneEdit && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
            <input className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              placeholder="场景名称 *（如：比赛日三件套）"
              value={sceneEdit.name}
              onChange={(e) => setSceneEdit({ ...sceneEdit, name: e.target.value })} />
            <div className="mt-2 text-xs font-medium text-slate-500">勾选要一起启动的程序 / 账号（按勾选顺序依次拉起）：</div>
            {launchables.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">还没有可启动的目标——先给工具卡或账号配好启动命令（⚙ 或 账号▾）。</p>
            )}
            <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border bg-white p-2">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1">
                {launchables.map((l) => (
                  <label key={l.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox"
                      checked={sceneEdit.items.includes(l.key)}
                      onChange={(e) => setSceneEdit({
                        ...sceneEdit,
                        items: e.target.checked ? [...sceneEdit.items, l.key] : sceneEdit.items.filter((k) => k !== l.key),
                      })} />
                    <span className="truncate">{l.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button onClick={saveScene}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700">保存场景</button>
              <button onClick={() => setSceneEdit(null)}
                className="rounded-lg border bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">取消</button>
            </div>
          </div>
        )}
      </div>

      {/* 卡墙流式自适应：auto-fit 空轨道会收缩，末行不满时卡片自动拉宽铺满、不留右侧空漏 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        {shown.map((c) => (
          <div key={c.id} className="card-fluid flex flex-col rounded-xl border bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{c.toolName}</div>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${CATEGORY_COLORS[c.category] ?? CATEGORY_COLORS.other}`}>
                  {CATEGORY_LABELS[c.category] ?? c.category}
                </span>
              </div>
              <button onClick={() => removeConnection(c.id, c.toolName)}
                className="shrink-0 text-xs text-slate-300 hover:text-red-500">删</button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-slate-500">{c.accountNotes || "—"}</p>
            {c.credentialRef && (
              <button onClick={() => openCredential(c)} title={`定位：${c.credentialRef}`}
                className="mt-1 block max-w-full truncate text-left text-xs text-slate-400 hover:text-blue-600 hover:underline">
                凭据引用：{c.credentialRef}（点击定位 ↗）
              </button>
            )}
            {c.tags && <p className="mt-1 text-xs text-slate-400">{c.tags}</p>}
            {acctOpen === c.id && (
              <div className="mt-2 rounded-lg border bg-slate-50 p-2">
                <div className="text-xs font-medium text-slate-500">账号条目（每个号一份独立登录空间，点 ▶ 直接切过去）</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  首次点开后自己登录一次，之后免密；工作台只存启动命令，<span className="text-slate-500">不存也不读密码</span>。
                </div>
                <div className="mt-0.5 text-xs text-slate-400" title={BOUNDARY_TIP}>
                  边界：一个号只在一个登录空间长期活着；第三方授权可能跳回主窗口；IP/设备指纹这一层不隔离（悬看详情）。
                </div>
                {c.accounts.length === 0 && <div className="mt-1 text-xs text-slate-400">还没有号，在下面起个名字就能加</div>}
                {acctHint && <div className="mt-1 whitespace-pre-line break-all text-xs text-emerald-700">{acctHint}</div>}
                {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
                {c.accounts.map((a) => (
                  <div key={a.id} className="mt-1 flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs" title={a.launchCommand || a.notes}>{a.label}</span>
                    {acctProbe[a.id] && (
                      <span className="shrink-0" title={PROBE_TIP[acctProbe[a.id]] ?? ""}>{PROBE_ICON[acctProbe[a.id]] ?? ""}</span>
                    )}
                    <button onClick={() => launchAccount(a)}
                      title={a.launchCommand ? `切到「${a.label}」：用它自己的登录空间启动` : "该号还没有启动命令"}
                      className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white hover:bg-blue-700">▶</button>
                    <button onClick={() => openAccountDir(a)} title="在资源管理器里打开这个号的登录空间目录"
                      className="text-xs text-slate-300 hover:text-blue-600">📁</button>
                    <button onClick={() => stopAccount(a)} title="只结束命令行里带着这个号目录的进程，不按程序名杀"
                      className="text-xs text-slate-300 hover:text-red-500">■</button>
                    <button onClick={() => regenAccount(a)} title="按卡片现在的程序路径/入口网址重建这个号的登录空间命令"
                      className="text-xs text-slate-300 hover:text-blue-600">↻</button>
                    <button onClick={() => deleteAccount(a)} title="删这条号，下一步会问你要不要连登录空间目录一起清"
                      className="text-xs text-slate-300 hover:text-red-500">删</button>
                  </div>
                ))}
                <div className="mt-2 flex gap-1.5">
                  <input className="min-w-0 flex-1 rounded border px-2 py-1 text-xs" placeholder="号名（如：号2 / 工作号）*"
                    value={acctForm.label} onChange={(e) => setAcctForm({ ...acctForm, label: e.target.value })} />
                  <button onClick={() => addAccount(c)}
                    className="shrink-0 rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-700">+ 加一个号</button>
                  <button onClick={() => setAcctAdv((v) => !v)}
                    title="留空则由服务端生成独立登录空间命令；确有必要时才手写"
                    className="shrink-0 rounded border px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600">高级 {acctAdv ? "▴" : "▾"}</button>
                </div>
                {acctAdv && (
                  <input className="mt-1.5 w-full rounded border px-2 py-1 text-xs" placeholder="手写启动命令（填了就按你写的存，不自动生成）"
                    value={acctForm.cmd} onChange={(e) => setAcctForm({ ...acctForm, cmd: e.target.value })} />
                )}
              </div>
            )}
            <div className="mt-auto flex items-center justify-between border-t pt-2">
              <span className="text-xs tabular-nums text-slate-400">
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
                {c.accounts.some((a) => a.launchCommand.trim()) && (
                  <button onClick={() => rotateNext(c)}
                    title={`轮切到下一个账号（当前第 ${((rotateCursor[c.id] ?? -1) + 1) % (c.accounts.filter((a) => a.launchCommand.trim()).length || 1) + 1} 号，共 ${c.accounts.filter((a) => a.launchCommand.trim()).length} 号）`}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                    🔄 换下一号
                  </button>
                )}
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
          <div className="card-fluid col-span-full rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-400">
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
