import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

const JUBAO_STATE = "E:\\3.赛博聚宝盆\\asset-registry\\data\\state.json";

/**
 * 从赛博聚宝盆导入资产登记为雀台项目。
 * 只读聚宝盆 state.json，不改动聚宝盆任何文件。
 * types: 导入的资产类型白名单，默认 ["skill","program"]（聚宝盆中 expert/connector 语义不明，不擅自导入）
 */
export async function POST(req: Request) {
  let types = ["skill", "program"];
  try {
    const body = await req.json();
    if (Array.isArray(body.types) && body.types.length > 0) {
      types = body.types.map(String);
    }
  } catch { /* 默认 skill+program */ }

  if (!existsSync(JUBAO_STATE)) {
    return NextResponse.json({ ok: false, error: `聚宝盆状态文件不存在：${JUBAO_STATE}` }, { status: 404 });
  }

  let state: { assets?: Record<string, { lastKnownPath?: string; overlay?: { hidden?: boolean; starred?: boolean; remark?: string } }> };
  try {
    state = JSON.parse(await readFile(JUBAO_STATE, "utf-8"));
  } catch (e) {
    return NextResponse.json({ ok: false, error: `读取聚宝盆状态失败：${String(e)}` }, { status: 500 });
  }

  const assets = state.assets ?? {};
  const existing = await prisma.project.findMany({ select: { path: true } });
  const existingPaths = new Set(existing.map((p) => p.path.toLowerCase()));

  let imported = 0;
  let skippedHidden = 0;
  let skippedDup = 0;
  let skippedEmpty = 0;
  let skippedType = 0;
  const samples: string[] = [];

  for (const [id, a] of Object.entries(assets)) {
    const overlay = a.overlay ?? {};
    const [kind, ...rest] = id.split(":");
    if (id.startsWith("__") || id === "--star") { skippedType++; continue; }
    if (!types.includes(kind)) { skippedType++; continue; }
    if (overlay.hidden) { skippedHidden++; continue; }
    const path = (a.lastKnownPath ?? "").trim();
    if (!path) { skippedEmpty++; continue; }
    if (existingPaths.has(path.toLowerCase())) { skippedDup++; continue; }

    const name = rest.join(":") || id;
    const category = kind === "skill" ? "skill" : "product";
    const remark = overlay.remark ? String(overlay.remark) : "";

    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          name,
          path,
          category,
          status: "incubating",
          summary: remark || `自聚宝盆导入（${kind}）`,
          tags: `聚宝盆,${kind}`,
          lastNote: `2026-10-04 自赛博聚宝盆导入（types=${types.join("+")}）`,
        },
      });
      await logEvent(tx, "project", p.id, "import_jubao", null, { id, path, kind, types });
      return p;
    });
    existingPaths.add(path.toLowerCase());
    imported++;
    if (samples.length < 5) samples.push(`${name} @ ${path}`);
  }

  return NextResponse.json({
    ok: true,
    types,
    totalInJubao: Object.keys(assets).length,
    imported,
    skippedHidden,
    skippedDup,
    skippedEmpty,
    skippedType,
    samples,
    note: "聚宝盆文件未被改动；导入项状态为孵化中，可在项目中枢调整",
  });
}
