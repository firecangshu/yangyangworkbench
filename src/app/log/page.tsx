"use client";

import { useEffect, useState } from "react";

type EventRow = {
  id: number;
  ts: string;
  entityType: string;
  entityId: number;
  action: string;
  beforeJson: string;
  afterJson: string;
};

const ACTION_LABELS: Record<string, string> = {
  create: "新建",
  update: "修改",
  delete: "删除",
  open_dir: "打开目录",
};

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

export default function LogPage() {
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then(setEvents);
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">操作流水</h1>
        <p className="mt-1 text-sm text-slate-500">
          借鉴 Apache Maka · append-only 事件日志 · 最近 {events.length} 条
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-4 py-3 font-medium">对象</th>
              <th className="px-4 py-3 font-medium">动作</th>
              <th className="px-4 py-3 font-medium">改前 → 改后</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.map((e) => {
              const before = tryParse(e.beforeJson);
              const after = tryParse(e.afterJson);
              const changedKeys = after && before
                ? Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]))
                : after
                  ? Object.keys(after)
                  : before
                    ? Object.keys(before)
                    : [];
              return (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    {new Date(e.ts).toLocaleString("zh-CN", { hour12: false })}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    #{e.entityId}
                    {after?.name || before?.name ? ` ${String(after?.name ?? before?.name)}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                      {ACTION_LABELS[e.action] ?? e.action}
                    </span>
                  </td>
                  <td className="max-w-xl px-4 py-3 text-xs text-slate-600">
                    {e.action === "create" && after && (
                      <span>新建：{String(after.name)} @ {String(after.path)}</span>
                    )}
                    {e.action === "delete" && before && (
                      <span className="text-red-600">删除：{String(before.name)}</span>
                    )}
                    {e.action === "update" && changedKeys.length > 0 && (
                      <ul className="space-y-1">
                        {changedKeys.slice(0, 5).map((k) => (
                          <li key={k}>
                            <code className="text-slate-400">{k}</code>:{" "}
                            <span className="text-slate-400 line-through">
                              {String(before?.[k] ?? "—")}
                            </span>{" "}
                            →{" "}
                            <span className="font-medium">
                              {String(after?.[k] ?? "—")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.action === "open_dir" && after && (
                      <span className="text-slate-400">{String(after.path)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  暂无流水，任何项目操作都会出现在这里
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
