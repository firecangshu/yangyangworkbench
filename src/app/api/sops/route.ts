import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/** SOP 模板库（M10）：把可复用的流程定义一次，套用到比赛生成检查清单 */
export async function GET() {
  const sops = await prisma.sopTemplate.findMany({
    orderBy: { id: "asc" },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
  return NextResponse.json(sops);
}

export async function POST(req: Request) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "模板名称为必填项" }, { status: 400 });
  const stepNames = Array.isArray(body.steps)
    ? body.steps.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
    : String(body.steps ?? "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
  if (stepNames.length === 0) {
    return NextResponse.json({ error: "至少需要一步（每行一步）" }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.sopTemplate.create({
      data: {
        name,
        description: String(body.description ?? ""),
        steps: { create: stepNames.map((s: string, i: number) => ({ name: s, sortOrder: i })) },
      },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    await logEvent(tx, "sop_template", t.id, "create", null, {
      name,
      description: t.description,
      steps: stepNames,
    });
    return t;
  });
  return NextResponse.json(created, { status: 201 });
}
