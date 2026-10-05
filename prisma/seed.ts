import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const seedProjects = [
  {
    name: "鹅在——AI智能体居家守护系统",
    path: "E:\\27.鹅在——AI智能体居家守护系统",
    category: "product",
    status: "dev",
    summary: "居家守护智能体，waveguard 主仓库，多场比赛进行中",
    tags: "家居安防,比赛,GOSIM,Anker",
  },
  {
    name: "讯飞门神",
    path: "E:\\31.讯飞门神",
    category: "skill",
    status: "maintain",
    summary: "Skill 准入检测 v5.0.0，讯飞 #7 CQA-Skill 赛道",
    tags: "skill,质检,讯飞比赛",
  },
  {
    name: "张良出题博弈师",
    path: "E:\\39.张良出题博弈师——talents-eval-master",
    category: "skill",
    status: "maintain",
    summary: "TalentsAI 出题全流程固化 v1.0",
    tags: "skill,评测,出题",
  },
  {
    name: "灯塔 Lighthouse",
    path: "E:\\6.灯塔—lighthouse",
    category: "skill",
    status: "maintain",
    summary: "人生导航 skill，讯飞 #1 情绪价值方向",
    tags: "skill,情绪价值,比赛",
  },
  {
    name: "人类香水 human-perfume",
    path: "E:\\24.人类香水——human-perfume",
    category: "skill",
    status: "maintain",
    summary: "去 AI 味写作 skill，v1.6.0 评测 100% 通过",
    tags: "skill,写作,ModelScope",
  },
  {
    name: "赛博GEO",
    path: "E:\\32.赛博GEO",
    category: "skill",
    status: "submitted",
    summary: "AI 搜索可见度诊断，已上架 SkillHub + 涌现奖投递",
    tags: "skill,GEO,SkillHub,涌现奖",
  },
  {
    name: "踏歌行专利智多星",
    path: "E:\\7.踏歌行专利智多星——patent-expert-team_v2.0.0",
    category: "patent",
    status: "maintain",
    summary: "PySide6 专利申报全流程引导工具",
    tags: "专利,工具",
  },
  {
    name: "金点子·反自嗨神器",
    path: "E:\\1.金点子golden-idea-source",
    category: "skill",
    status: "maintain",
    summary: "创意评估 skill v1.9.1，目标 80%+ 通过率",
    tags: "skill,创意评估,比赛",
  },
];

async function main() {
  const existing = await prisma.project.count();
  if (existing > 0) {
    console.log(`已有 ${existing} 个项目，跳过 seed（如需重灌请先清库）`);
    return;
  }
  for (const p of seedProjects) {
    const created = await prisma.project.create({ data: p });
    await prisma.eventLog.create({
      data: {
        entityType: "project",
        entityId: created.id,
        action: "create",
        beforeJson: "{}",
        afterJson: JSON.stringify(p),
      },
    });
  }
  console.log(`已写入 ${seedProjects.length} 个真实项目`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
