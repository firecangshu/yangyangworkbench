import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { noteJSON } from "@/lib/serializers";
import { normDate } from "@/lib/contest-playbook";

const VALID_KIND = ["note", "reminder"];

/**
 * GET /api/notes?from=yyyy-MM-dd&to=yyyy-MM-dd
 * 带 from/to 时按日期区间过滤（升序），否则返回全部。供月历当月取数 + 首页未来待办共用。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = normDate(searchParams.get("from"));
  const to = normDate(searchParams.get("to"));
  const where =
    from && to ? { date: { gte: from, lte: to } }
    : from ? { date: { gte: from } }
    : to ? { date: { lte: to } }
    : {};
  const notes = await prisma.calendarNote.findMany({ where, orderBy: { date: "asc" } });
  return NextResponse.json(notes);
}

export async function POST(req: Request) {
  const body = await req.json();
  const date = normDate(String(body.date ?? ""));
  if (!date) return NextResponse.json({ error: "date 必须为合法日期 yyyy-MM-dd" }, { status: 400 });
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "备注内容为必填项" }, { status: 400 });
  const kind = String(body.kind ?? "note");
  if (!VALID_KIND.includes(kind)) return NextResponse.json({ error: "kind 只能为 note 或 reminder" }, { status: 400 });

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.calendarNote.create({ data: { date, text, kind, done: false } });
    await logEvent(tx, "note", created.id, "create", null, noteJSON(created));
    return created;
  });
  return NextResponse.json(note, { status: 201 });
}
