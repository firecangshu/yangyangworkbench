import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * M32 赛事融入标准手册（通用 SOP）种子。
 * 幂等：按名 upsert，重跑会刷新步骤。作为 AI 助手融入新比赛时对齐的通用底稿——
 * 助手把该赛 requirements 映射到这些标准步骤，缺项一律「待定」不脑补（红线④）。
 * 四段前缀（赛前分析/赛中准备/材料递交/时间表）编进步骤名，供任务清单分组显示。
 */
const SOP_NAME = "赛事融入标准手册";
const SOP_DESC =
  "通用版赛事融入流程底稿：AI 助手据此把新比赛的官网资讯匹配对齐，拆解为赛前分析→赛中准备→材料递交→时间表四段可执行清单，再有机铺开到工作台各板块。缺项标「待定」，人工确认后落库。";

const STEPS: string[] = [
  "赛前分析 · 赛事基本信息核对（名称/主办方/起止/提交链接）",
  "赛前分析 · 主题与赛道契合度分析",
  "赛前分析 · 竞品与选题调研（横纵分析法）",
  "赛前分析 · 关键时间节点确认（报名/初筛/提交/路演/公布）",
  "赛中准备 · 关联作品选定与对齐",
  "赛中准备 · 技术方案冻结",
  "赛中准备 · 内部评审 / 自检",
  "材料递交 · 报名表填写",
  "材料递交 · 项目简介 / 一句话定位",
  "材料递交 · 演示材料（PPT / Demo / 路演页）",
  "材料递交 · 合规 / 原创声明",
  "材料递交 · 格式与字数按官方要求校验",
  "材料递交 · 官方渠道提交并留存回执",
  "时间表 · 报名截止提醒",
  "时间表 · 材料内审节点提醒",
  "时间表 · 提交截止提醒",
  "时间表 · 路演 / 答辩提醒",
  "时间表 · 结果公布提醒",
];

async function main() {
  const existing = await prisma.sopTemplate.findFirst({ where: { name: SOP_NAME } });
  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.sopStep.deleteMany({ where: { templateId: existing.id } });
      await tx.sopTemplate.update({
        where: { id: existing.id },
        data: {
          description: SOP_DESC,
          steps: { create: STEPS.map((name, i) => ({ name, sortOrder: i })) },
        },
      });
    });
    console.log(`已刷新 SOP「${SOP_NAME}」（${STEPS.length} 步）`);
    return;
  }
  const created = await prisma.sopTemplate.create({
    data: {
      name: SOP_NAME,
      description: SOP_DESC,
      steps: { create: STEPS.map((name, i) => ({ name, sortOrder: i })) },
    },
    include: { steps: true },
  });
  console.log(`已创建 SOP「${SOP_NAME}」id=${created.id}（${created.steps.length} 步）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
