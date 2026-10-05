import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent, projectJSON } from "@/lib/events";

const VALID_CATEGORIES = ["skill", "product", "contest", "patent", "other"];
const VALID_STATUS = ["incubating", "dev", "submitted", "maintain", "done"];

export async function GET() {
  const projects = await prisma.project.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const path = String(body.path ?? "").trim();

  if (!name || !path) {
    return NextResponse.json({ error: "名称和路径为必填项" }, { status: 400 });
  }

  const category = VALID_CATEGORIES.includes(body.category) ? body.category : "other";
  const status = VALID_STATUS.includes(body.status) ? body.status : "incubating";

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name,
        path,
        category,
        status,
        summary: String(body.summary ?? ""),
        tags: String(body.tags ?? ""),
        lastNote: String(body.lastNote ?? ""),
      },
    });
    await logEvent(tx, "project", created.id, "create", null, projectJSON(created));
    return created;
  });

  return NextResponse.json(project, { status: 201 });
}
