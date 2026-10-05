"use client";

import { useCallback, useEffect, useState } from "react";
import { setTheme } from "@/components/ThemeProvider";

type BackupInfo = {
  dirName: string;
  path: string;
  sizeKB: number;
  createdAt?: string;
  counts?: Record<string, number>;
  dbCopied?: boolean;
};

type ScanReport = {
  numberedTotal: number;
  duplicateGroups: { num: number; count: number; dirs: { name: string; mtime: string }[] }[];
  garbledDirs: { name: string; num: number }[];
  scannedAt: string;
};

const MCP_SNIPPET = `{
  "mcpServers": {
    "queetai": {
      "command": "node",
      "args": ["E:\\\\Documents\\\\Loomy Workspace\\\\工作台\\\\雀台\\\\mcp\\\\server.mjs"]
    }
  }
}`;

const BITWARDEN_SNIPPET = `{
  "mcpServers": {
    "bitwarden": {
      "command": "npx",
      "args": ["-y", "@bitwarden/mcp-server"],
      "env": {
        "BW_SESSION": "解锁会话密钥（bw unlock 输出，勿提交到任何仓库）"
      }
    }
  }
}`;

export default function SettingsPage() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);

  const [cloud, setCloud] = useState({ baseUrl: "", model: "glm-4.5-air", credentialRef: "", prompt: "你好，请用一句话回复确认你在线。" });
  const [cloudResult, setCloudResult] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);

  const [scan, setScan] = useState<ScanReport | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [theme, setThemeState] = useState("industrial");
  const [importMsg, setImportMsg] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [credHealth, setCredHealth] = useState({ covered: 0, total: 0, missing: [] as string[] });
  const [copiedBw, setCopiedBw] = useState(false);

  useEffect(() => {
    setThemeState(localStorage.getItem("queetai-theme") || "industrial");
  }, []);

  function chooseTheme(t: string) {
    setTheme(t);
    setThemeState(t);
  }

  async function importJubao(kind: "skill+program" | "skill") {
    const types = kind === "skill" ? ["skill"] : ["skill", "program"];
    if (!window.confirm(`导入聚宝盆的 ${types.join("+")} 类资产？已登记路径自动去重，聚宝盆文件不会被改动。`)) return;
    setImportBusy(true);
    setImportMsg("导入中…");
    try {
      const res = await fetch("/api/import/jubao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types }),
      });
      const d = await res.json();
      if (res.ok) {
        setImportMsg(`✅ 导入 ${d.imported} 条（类型 ${d.types.join("+")}；跳过：重复 ${d.skippedDup} / 隐藏 ${d.skippedHidden} / 非白名单 ${d.skippedType} / 空路径 ${d.skippedEmpty}）`);
        load();
      } else {
        setImportMsg(`❌ ${d.error ?? res.status}`);
      }
    } catch (e) {
      setImportMsg(`❌ ${String(e)}`);
    }
    setImportBusy(false);
  }

  const load = useCallback(() => {
    fetch("/api/backup").then((r) => r.json()).then(setBackups);
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/contests").then((r) => r.json()),
      fetch("/api/connections").then((r) => r.json()),
      fetch("/api/events").then((r) => r.json()),
    ]).then(([p, c, conn, e]) => {
      setStats({ projects: p.length, contests: c.length, connections: conn.length, events: e.length });
      const covered = conn.filter((x: { credentialRef?: string }) => (x.credentialRef ?? "").trim()).length;
      setCredHealth({
        covered,
        total: conn.length,
        missing: conn.filter((x: { credentialRef?: string }) => !(x.credentialRef ?? "").trim()).map((x: { toolName: string }) => x.toolName),
      });
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runBackup() {
    setBusy(true);
    setMsg("备份中…");
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const d = await res.json();
      setMsg(res.ok ? `✅ 已备份到 ${d.dirName}${d.dbCopied ? "（含 SQLite 副本）" : "（仅 JSON）"}` : `❌ ${d.error ?? res.status}`);
      if (res.ok) load();
    } catch (e) {
      setMsg(`❌ ${String(e)}`);
    }
    setBusy(false);
  }

  async function copyMcp() {
    try {
      await navigator.clipboard.writeText(MCP_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      window.alert("复制失败，请手动选中复制");
    }
  }

  async function testCloud() {
    setCloudBusy(true);
    setCloudResult("调用中…");
    try {
      const res = await fetch("/api/cloud/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloud),
      });
      const d = await res.json();
      if (d.ok) {
        setCloudResult(`✅ HTTP ${d.status} · ${d.elapsedMs}ms · 模型回复：${d.reply ?? "（空）"}${d.usage ? ` · usage=${JSON.stringify(d.usage)}` : ""}`);
      } else {
        setCloudResult(`❌ ${d.error ?? d.stage ?? res.status}${d.status ? `（HTTP ${d.status}）` : ""}`);
      }
    } catch (e) {
      setCloudResult(`❌ ${String(e)}`);
    }
    setCloudBusy(false);
  }

  async function runScan() {
    setScanBusy(true);
    setScan(null);
    try {
      const res = await fetch("/api/scan/drive");
      setScan(await res.json());
    } catch (e) {
      setScan(null);
      window.alert(`体检失败：${String(e)}`);
    }
    setScanBusy(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-slate-500">本地优先 · 备份是你的数据安全网</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Object.entries({ 项目: stats.projects ?? 0, 比赛: stats.contests ?? 0, 连接: stats.connections ?? 0, 流水: stats.events ?? 0 }).map(
          ([label, n]) => (
            <div key={label} className="rounded-xl border bg-white p-4">
              <div className="text-sm text-slate-500">{label}</div>
              <div className="mt-1 text-3xl font-semibold">{n}</div>
            </div>
          )
        )}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">一键备份</div>
            <p className="mt-1 text-xs text-slate-500">
              导出全量 JSON 快照 + SQLite 文件副本到 <code className="rounded bg-slate-100 px-1">雀台/backups/</code>
            </p>
          </div>
          <button onClick={runBackup} disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50">
            {busy ? "备份中…" : "立即备份"}
          </button>
        </div>
        {msg && <div className="mt-3 text-sm">{msg}</div>}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium">MCP 接入（让 AI 工具查雀台数据）</div>
        <p className="mb-3 text-xs text-slate-500">
          把下面片段粘贴到 Claude / CodeBuddy 等工具的 MCP 配置（mcp.json）里，AI 即可调用
          list_projects / list_contests / get_project / add_event 四个工具。
        </p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{MCP_SNIPPET}</pre>
          <button onClick={copyMcp}
            className="absolute right-2 top-2 rounded-md bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600">
            {copied ? "已复制 ✓" : "复制"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          安全：stdio 本地管道、无网络端口；只读为主，add_event 仅追加备注流水。
        </p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium">凭据健康（M10）</div>
        <p className="mb-3 text-xs text-slate-500">
          工具卡的凭据引用覆盖率。引用只是「去哪里找」的路径提示，不含任何密码；正式的密钥保管请装 Bitwarden。
        </p>
        <div className="text-2xl font-semibold">
          {credHealth.covered} <span className="text-base text-slate-400">/ {credHealth.total} 张卡已配引用</span>
        </div>
        {credHealth.missing.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            未配置：{credHealth.missing.join("、")}
          </p>
        )}
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Bitwarden MCP（AI 取密钥的正规通道）</div>
            <button onClick={() => { navigator.clipboard.writeText(BITWARDEN_SNIPPET).then(() => { setCopiedBw(true); setTimeout(() => setCopiedBw(false), 2000); }).catch(() => window.alert("复制失败")); }}
              className="rounded-md bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600">
              {copiedBw ? "已复制 ✓" : "复制片段"}
            </button>
          </div>
          <p className="my-2 text-xs text-slate-500">
            装 Bitwarden 后（<a href="https://github.com/bitwarden/mcp-server" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">官方 MCP server</a>），
            把下面片段粘进 AI 工具的 mcp.json：AI 每次取密钥都会弹授权，只读最小权限，密钥永不进对话。
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{BITWARDEN_SNIPPET}</pre>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium">云端模型调用测试</div>
        <p className="mb-3 text-xs text-slate-500">
          API key 只从本地凭据文件读取，不入库、不回传。先把 key 写入一个本地文件，把路径填到「凭据文件」。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="API Base URL，如 https://open.bigmodel.cn/api/paas/v4"
            value={cloud.baseUrl} onChange={(e) => setCloud({ ...cloud, baseUrl: e.target.value })} />
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="模型名"
            value={cloud.model} onChange={(e) => setCloud({ ...cloud, model: e.target.value })} />
          <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="凭据文件绝对路径（本地 txt，第一行为 key）"
            value={cloud.credentialRef} onChange={(e) => setCloud({ ...cloud, credentialRef: e.target.value })} />
          <input className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" placeholder="测试提示词"
            value={cloud.prompt} onChange={(e) => setCloud({ ...cloud, prompt: e.target.value })} />
        </div>
        <button onClick={testCloud} disabled={cloudBusy}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50">
          {cloudBusy ? "调用中…" : "发起真实调用"}
        </button>
        {cloudResult && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{cloudResult}</div>}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium">E 盘编号目录体检（只读）</div>
        <p className="mb-3 text-xs text-slate-500">
          检测同号多目录与疑似乱码目录。<span className="font-medium text-slate-700">只报告，不删除任何东西。</span>
        </p>
        <button onClick={runScan} disabled={scanBusy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50">
          {scanBusy ? "体检中…" : "开始体检"}
        </button>
        {scan && (
          <div className="mt-4 space-y-3 text-sm">
            <div className="text-xs text-slate-500">
              扫描 {scan.numberedTotal} 个编号目录 · {new Date(scan.scannedAt).toLocaleString("zh-CN", { hour12: false })}
            </div>
            {scan.duplicateGroups.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-amber-700">同号多目录（{scan.duplicateGroups.length} 组）</div>
                {scan.duplicateGroups.map((g) => (
                  <div key={g.num} className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
                    <div className="text-xs font-medium">#{g.num} × {g.count}</div>
                    {g.dirs.map((d) => (
                      <div key={d.name} className="mt-1 break-all text-xs text-slate-600">
                        {d.name} <span className="text-slate-400">（{d.mtime}）</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {scan.garbledDirs.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-red-700">疑似乱码目录（{scan.garbledDirs.length} 个）</div>
                {scan.garbledDirs.map((d) => (
                  <div key={d.name} className="break-all text-xs text-slate-600">#{d.num} {d.name}</div>
                ))}
              </div>
            )}
            {scan.duplicateGroups.length === 0 && scan.garbledDirs.length === 0 && (
              <div className="text-slate-500">未发现重复或乱码目录</div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium">界面主题</div>
        <p className="mb-3 text-xs text-slate-500">选中的主题保存在本机浏览器，立即生效。</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { id: "industrial", name: "工业铁灰", desc: "默认 · 安全橙", colors: ["#16191e", "#1b2028", "#ea580c"] },
            { id: "minimal", name: "极简白", desc: "经典亮色", colors: ["#f6f7f9", "#ffffff", "#2563eb"] },
            { id: "goose", name: "护院鹅深绿", desc: "路演基准", colors: ["#07150e", "#0d2418", "#6ee7a8"] },
            { id: "ink", name: "墨蓝夜航", desc: "深色科技", colors: ["#070b14", "#0f172a", "#38bdf8"] },
            { id: "paper", name: "纸墨杂志", desc: "暖纸印刷", colors: ["#f3ede1", "#fffdf7", "#b91c1c"] },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => chooseTheme(t.id)}
              className={`rounded-xl border p-3 text-left transition ${
                theme === t.id ? "border-blue-500 ring-1 ring-blue-400" : "hover:border-slate-300"
              }`}
            >
              <div className="flex gap-1">
                {t.colors.map((c) => (
                  <span key={c} className="h-6 w-6 rounded border border-black/10" style={{ background: c }} />
                ))}
              </div>
              <div className="mt-2 text-sm font-medium">{t.name}</div>
              <div className="text-xs text-slate-400">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-1 font-medium">赛博聚宝盆 · 资产导入</div>
        <p className="mb-3 text-xs text-slate-500">
          只读聚宝盆 <code className="rounded bg-slate-100 px-1">state.json</code>，把 skill / 程序类资产导入为雀台项目（expert/connector 类语义不明，暂不导入）。
          <span className="font-medium text-slate-700">不改动聚宝盆任何文件</span>；已登记路径自动去重。
        </p>
        <div className="flex gap-2">
          <button onClick={() => importJubao("skill+program")} disabled={importBusy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50">
            {importBusy ? "导入中…" : "导入 skill + 程序"}
          </button>
          <button onClick={() => importJubao("skill")} disabled={importBusy}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            仅导入 skill
          </button>
        </div>
        {importMsg && <div className="mt-3 text-sm">{importMsg}</div>}
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 font-medium">备份历史</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">备份目录</th>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">大小</th>
                <th className="px-3 py-2 font-medium">SQLite</th>
                <th className="px-3 py-2 font-medium">数据量（项/赛/连接/流水）</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {backups.map((b) => (
                <tr key={b.dirName}>
                  <td className="px-3 py-2 text-xs" title={b.path}>{b.dirName}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {b.createdAt ? new Date(b.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{b.sizeKB} KB</td>
                  <td className="px-3 py-2 text-xs">{b.dbCopied ? "✅" : "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {b.counts ? `${b.counts.projects ?? 0} / ${b.counts.contests ?? 0} / ${b.counts.connections ?? 0} / ${b.counts.events ?? 0}` : "—"}
                  </td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">
                    还没有备份，点上方「立即备份」
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
