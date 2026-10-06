/**
 * M30 数据层哨兵：验证 schema 附加字段 round-trip + 连接卡种子存在。
 * 红线①：额外断言 credentialRef 只含路径字符串，不含真值。
 * 成功打印 M30_PASS，失败 exit(1)。
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // 1. 探针：建 Contest（含 resultDate）→ 建 Deliverable（含 stage/path）→ 读回 → 清理
  const contest = await prisma.contest.create({
    data: { name: "__m30_probe__", resultDate: "2026-12-01" },
  });
  const deliv = await prisma.deliverable.create({
    data: { contestId: contest.id, name: "probe-doc", stage: "onstage", path: "out/test.html" },
  });
  const readBack = await prisma.deliverable.findUnique({ where: { id: deliv.id } });
  if (!readBack || readBack.stage !== "onstage" || readBack.path !== "out/test.html") {
    console.error("FAIL: Deliverable stage/path round-trip");
    process.exit(1);
  }
  const cBack = await prisma.contest.findUnique({ where: { id: contest.id } });
  if (!cBack || cBack.resultDate !== "2026-12-01") {
    console.error("FAIL: Contest resultDate round-trip");
    process.exit(1);
  }
  // 清理探针（Cascade 删 deliverable）
  await prisma.contest.delete({ where: { id: contest.id } });

  // 2. 连接卡种子存在性
  const magician = await prisma.connection.findFirst({ where: { toolName: "黑客松路演魔术师" } });
  if (!magician || !magician.launchCommand.includes("app.py") || magician.entryUrl !== "http://localhost:7860") {
    console.error("FAIL: 魔术师连接卡种子缺失或字段不正确");
    process.exit(1);
  }
  const hv = await prisma.connection.findFirst({ where: { toolName: "横纵分析法调研" } });
  if (!hv) { console.error("FAIL: hv-analysis 连接卡缺失"); process.exit(1); }
  const aihot = await prisma.connection.findFirst({ where: { toolName: "AI HOT 资讯" } });
  if (!aihot) { console.error("FAIL: aihot 连接卡缺失"); process.exit(1); }

  // 3. 红线：credentialRef 只含路径字符串（不含 token 值）
  if (magician.credentialRef.includes("=") || magician.credentialRef.length > 100) {
    console.error("FAIL: credentialRef 疑似含有明文 token");
    process.exit(1);
  }

  console.log("M30_PASS");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
