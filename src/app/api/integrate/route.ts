import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { contestJSON, noteJSON } from "@/lib/serializers";
import { normDate } from "@/lib/contest-playbook";
import { type IntegrationPlan } from "@/lib/contest-integration";

/**
 * M32 融入落库：用户在 AssistantDock 看过「融入方案预览」并点「确认融入」后调用。
 * 一次事务把 Contest + Dossier + Deliverable 材料清单 + CalendarNote 提醒 + 可选关联项目
 * 有机铺开，全程 append-only 流水（红线③）。命中现有赛走对齐更新不重复建（红线②）。
 * 入参 plan 来自前端（可能不可信），日期/字段一律服务端再归一，缺项不落。
 */
const TBD = "待定";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function deliverableLabel(d: { name: string; standard: string }): string {
  const std = d.standard && d.standard !== TBD ? d.standard : "";
  return std ? `${d.name}｜${std}` : d.name;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const plan = body.plan as IntegrationPlan | undefined;
  const projectId = Number(body.projectId ?? 0);

  const name = String(plan?.contest?.name ?? "").trim();
  if (!plan || !name) {
    return NextResponse.json({ error: "融入方案缺少比赛名称" }, { status: 400 });
  }

  const contest = {
    name,
    organizer: String(plan.contest.organizer ?? ""),
    track: String(plan.contest.track ?? ""),
    startDate: normDate(plan.contest.startDate ?? ""),
    deadline: normDate(plan.contest.deadline ?? ""),
    resultDate: normDate(plan.contest.resultDate ?? ""),
    submitLink: String(plan.contest.submitLink ?? ""),
    status: String(plan.contest.status ?? "research"),
    notes: String(plan.contest.notes ?? ""),
  };
  const dossier = {
    timeInfo: String(plan.dossier?.timeInfo ?? "[]"),
    content: String(plan.dossier?.content ?? ""),
    theme: String(plan.dossier?.theme ?? ""),
    trackAnalysis: String(plan.dossier?.trackAnalysis ?? ""),
    requirements: String(plan.dossier?.requirements ?? "[]"),
    source: String(plan.dossier?.source ?? ""),
  };

  const result = await prisma.$transaction(async (tx: PrismaTx) => {
    const isUpdate = plan.match?.action === "update" && Number(plan.match?.contestId) > 0;
    let contestId: number;
    let action: "create" | "update";
    let before: Parameters<typeof contestJSON>[0] | null = null;

    if (isUpdate) {
      contestId = Number(plan.match.contestId);
      before = await tx.contest.findUnique({ where: { id: contestId } });
      if (!before) {
        // 命中目标已被删，退回新建
        action = "create";
        const c = await tx.contest.create({ data: contest });
        contestId = c.id;
        await logEvent(tx, "contest", c.id, "create", null, contestJSON(c));
      } else {
        action = "update";
        // 对齐更新：仅覆盖本次提供且非空的字段，不清空既有
        const patch: Record<string, string> = {};
        for (const [k, v] of Object.entries(contest)) {
          if (k === "name" || k === "status") continue;
          if (String(v ?? "").trim()) patch[k] = v;
        }
        const updated = await tx.contest.update({ where: { id: contestId }, data: patch });
        await logEvent(tx, "contest", contestId, "integrate_update", contestJSON(before), contestJSON(updated));
      }
    } else {
      const c = await tx.contest.create({ data: contest });
      contestId = c.id;
      action = "create";
      await logEvent(tx, "contest", c.id, "create", null, contestJSON(c));
    }

    // Dossier upsert（1:1，标已确认）
    const dossierData = {
      timeInfo: dossier.timeInfo, content: dossier.content, theme: dossier.theme,
      trackAnalysis: dossier.trackAnalysis, requirements: dossier.requirements, source: dossier.source,
      aiDraft: false, confirmedAt: new Date(),
    };
    const db0 = await tx.contestDossier.findUnique({ where: { contestId } });
    const ds = db0
      ? await tx.contestDossier.update({ where: { contestId }, data: dossierData })
      : await tx.contestDossier.create({ data: { contestId, ...dossierData } });
    await logEvent(tx, "dossier", ds.id, db0 ? "update" : "create", db0, { contestId, theme: ds.theme, aiDraft: ds.aiDraft });

    // Deliverable 材料清单：create 全落；update 跳过同名（不重复建）
    const existingDelivs = await tx.deliverable.findMany({ where: { contestId }, select: { name: true } });
    const existingNames = new Set(existingDelivs.map((d) => d.name.toLowerCase()));
    let delivAdded = 0;
    for (const d of plan.deliverables ?? []) {
      const label = deliverableLabel({ name: String(d.name ?? "").trim(), standard: String(d.standard ?? "") });
      if (!label || existingNames.has(label.toLowerCase())) continue;
      const created = await tx.deliverable.create({
        data: { contestId, name: label, stage: String(d.stage ?? ""), done: false },
      });
      await logEvent(tx, "deliverable", created.id, "create", null, { contestId, name: label, stage: created.stage });
      existingNames.add(label.toLowerCase());
      delivAdded++;
    }

    // CalendarNote 提醒：按 date+text 去重
    const existingNotes = await tx.calendarNote.findMany({ where: { kind: "reminder" }, select: { date: true, text: true } });
    const noteKeys = new Set(existingNotes.map((n) => `${n.date}|${n.text}`));
    let noteAdded = 0;
    for (const r of plan.reminders ?? []) {
      const date = normDate(r.date ?? "");
      const text = String(r.text ?? "").trim();
      if (!date || !text) continue;
      const key = `${date}|${text}`;
      if (noteKeys.has(key)) continue;
      const created = await tx.calendarNote.create({ data: { date, text, kind: "reminder", done: false } });
      await logEvent(tx, "note", created.id, "create", null, noteJSON(created));
      noteKeys.add(key);
      noteAdded++;
    }

    // 可选关联项目
    let linked = false;
    if (Number.isInteger(projectId) && projectId > 0) {
      const proj = await tx.project.findUnique({ where: { id: projectId } });
      if (proj) {
        const dup = await tx.contestProject.findFirst({ where: { contestId, projectId } });
        if (!dup) {
          await tx.contestProject.create({ data: { contestId, projectId } });
          await logEvent(tx, "contest_project", contestId, "link", null, { contestId, projectId });
          linked = true;
        }
      }
    }

    return { contestId, action, delivAdded, noteAdded, linked };
  });

  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
