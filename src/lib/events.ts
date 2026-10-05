import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * 事件日志引擎（借鉴 Apache Maka "The log is the runtime"）
 * 所有写操作在同一事务内追加 append-only 流水，保证与数据变更原子一致。
 */
export async function logEvent(
  tx: Prisma.TransactionClient,
  entityType: string,
  entityId: number,
  action: string,
  before: unknown,
  after: unknown
) {
  await tx.eventLog.create({
    data: {
      entityType,
      entityId,
      action,
      beforeJson: JSON.stringify(before ?? {}),
      afterJson: JSON.stringify(after ?? {}),
    },
  });
}

export const projectJSON = (p: {
  id: number;
  name: string;
  path: string;
  category: string;
  status: string;
  summary: string;
  tags: string;
  lastNote: string;
}) => ({
  id: p.id,
  name: p.name,
  path: p.path,
  category: p.category,
  status: p.status,
  summary: p.summary,
  tags: p.tags,
  lastNote: p.lastNote,
});
