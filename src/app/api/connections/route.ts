import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

export const connectionJSON = (c: {
  id: number; toolName: string; category: string; entryUrl: string;
  accountNotes: string; credentialRef: string; launchCommand: string; status: string; tags: string; notes: string;
}) => ({
  id: c.id, toolName: c.toolName, category: c.category, entryUrl: c.entryUrl,
  accountNotes: c.accountNotes, credentialRef: c.credentialRef, launchCommand: c.launchCommand,
  status: c.status, tags: c.tags, notes: c.notes,
});

export async function GET() {
  const connections = await prisma.connection.findMany({
    orderBy: { updatedAt: "desc" },
    include: { accounts: { orderBy: { id: "asc" } } },
  });
  return NextResponse.json(connections);
}

export async function POST(req: Request) {
  const body = await req.json();
  const toolName = String(body.toolName ?? "").trim();
  if (!toolName) return NextResponse.json({ error: "工具名称为必填项" }, { status: 400 });

  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.connection.create({
      data: {
        toolName,
        category: String(body.category ?? "other"),
        entryUrl: String(body.entryUrl ?? ""),
        accountNotes: String(body.accountNotes ?? ""),
        credentialRef: String(body.credentialRef ?? ""),
        launchCommand: String(body.launchCommand ?? ""),
        status: String(body.status ?? "active"),
        tags: String(body.tags ?? ""),
        notes: String(body.notes ?? ""),
      },
    });
    await logEvent(tx, "connection", created.id, "create", null, connectionJSON(created));
    return created;
  });
  return NextResponse.json(connection, { status: 201 });
}
