/**
 * 序列化/校验 helper（从 route 文件迁出）：
 * Next.js typedRoutes 禁止 route 模块导出非 handler 成员，共享函数一律放 lib。
 */

export const connectionJSON = (c: {
  id: number; toolName: string; category: string; entryUrl: string;
  accountNotes: string; credentialRef: string; launchCommand: string; status: string; tags: string; notes: string;
}) => ({
  id: c.id, toolName: c.toolName, category: c.category, entryUrl: c.entryUrl,
  accountNotes: c.accountNotes, credentialRef: c.credentialRef, launchCommand: c.launchCommand,
  status: c.status, tags: c.tags, notes: c.notes,
});

export const contestJSON = (c: {
  id: number; name: string; organizer: string; track: string;
  startDate: string; deadline: string; resultDate: string; status: string; submitLink: string; notes: string;
}) => ({
  id: c.id, name: c.name, organizer: c.organizer, track: c.track,
  startDate: c.startDate, deadline: c.deadline, resultDate: c.resultDate, status: c.status, submitLink: c.submitLink, notes: c.notes,
});

/** M31 日历备注/提醒序列化（供流水 before/after 与前端共用） */
export const noteJSON = (n: {
  id: number; date: string; text: string; kind: string; done: boolean;
}) => ({
  id: n.id, date: n.date, text: n.text, kind: n.kind, done: n.done,
});

/** 启动场景成员校验：合法返回数组，非法返回错误文案 */
export function parseItems(raw: unknown): { kind: string; refId: number }[] | string {
  if (!Array.isArray(raw)) return "items 必须为数组";
  const items: { kind: string; refId: number }[] = [];
  for (const it of raw) {
    const kind = String(it?.kind ?? "");
    const refId = Number(it?.refId);
    if (!["connection", "account"].includes(kind)) return "kind 只能为 connection 或 account";
    if (!Number.isInteger(refId) || refId <= 0) return "refId 必须为正整数";
    if (!items.some((x) => x.kind === kind && x.refId === refId)) items.push({ kind, refId });
  }
  return items;
}
