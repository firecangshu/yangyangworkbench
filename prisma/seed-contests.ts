import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedDeliverable = { name: string; done?: boolean };
type SeedContest = {
  name: string;
  organizer: string;
  track: string;
  deadline?: string;
  status: string;
  submitLink?: string;
  notes?: string;
  projectNames: string[];
  deliverables: SeedDeliverable[];
};

// 真实比赛数据：截止日记忆中无确切值的不脑补，留空显示"待定"
const seedContests: SeedContest[] = [
  {
    name: "GOSIM Shenzhen 2026 智能体软件工厂黑客松",
    organizer: "GOSIM",
    track: "智能体软件工厂",
    status: "registered",
    notes: "队伍 FT-踏歌行，以鹅在（GuardGoose）参赛；另已报名长三角赛事",
    projectNames: ["鹅在——AI智能体居家守护系统"],
    deliverables: [
      { name: "项目 BP / 介绍材料" },
      { name: "演示 Demo" },
      { name: "官方提交表" },
      { name: "README / 项目说明" },
    ],
  },
  {
    name: "AI杭州2026 超级智能体赛道",
    organizer: "AI杭州2026",
    track: "AI+超级智能体 · 创业组",
    status: "preparing",
    notes: "材料整理在 F:\\loomy workspace\\AI杭州2026-超级智能体赛道\\",
    projectNames: ["鹅在——AI智能体居家守护系统"],
    deliverables: [
      { name: "商业计划书" },
      { name: "路演 PPT" },
      { name: "Demo 演示" },
      { name: "报名表" },
    ],
  },
  {
    name: "Anker 首届黑客松挑战赛",
    organizer: "Anker",
    track: "智能安防赛道（eufy 视觉双模守护）",
    status: "preparing",
    notes: "以「善护念 Sensilent × FT-踏歌行」名义参赛",
    projectNames: ["鹅在——AI智能体居家守护系统"],
    deliverables: [
      { name: "方案文档" },
      { name: "演示 Demo" },
      { name: "官方提交表" },
    ],
  },
  {
    name: "支付宝智能体涌现奖",
    organizer: "支付宝",
    track: "消费新体验 + 生活好帮手",
    status: "submitted",
    submitLink: "https://render.qmuse.pub/p/muse/2693945714190710",
    notes: "赛博GEO 已在 QMuse 生成演示应用并自动投递；灯塔规划投「生活好帮手」",
    projectNames: ["赛博GEO", "灯塔 Lighthouse"],
    deliverables: [
      { name: "赛博GEO 演示应用（QMuse）", done: true },
      { name: "灯塔 演示方案" },
      { name: "投递确认" },
    ],
  },
  {
    name: "TalentsAI 指令遵循系列评测",
    organizer: "TalentsAI",
    track: "指令遵循 · 文旅场景多轮陷阱题",
    status: "preparing",
    notes: "长期参与；出题流程已固化为张良·出题博弈师 v1.0",
    projectNames: ["张良出题博弈师"],
    deliverables: [
      { name: "出题集（多轮 UP）" },
      { name: "终审模拟审计自检" },
      { name: "提交确认" },
    ],
  },
  {
    name: "讯飞 Skill 技能开发系列比赛",
    organizer: "讯飞",
    track: "12 个 Skill 技能开发赛道",
    status: "submitted",
    notes: "已全部投完：门神 #7、赛博GEO #6、学霸 #10、人类香水 #6、灯塔 #1、金点子 DIA 等",
    projectNames: [
      "讯飞门神",
      "灯塔 Lighthouse",
      "人类香水 human-perfume",
      "金点子·反自嗨神器",
      "赛博GEO",
    ],
    deliverables: [
      { name: "各赛道提交包", done: true },
      { name: "商业计划书（赛博GEO 方向）", done: true },
    ],
  },
  {
    name: "ModelScope Intel+OpenVINO 比赛",
    organizer: "ModelScope / Intel",
    track: "本地推理优化",
    status: "research",
    notes: "人类香水已改造为本地推理版 human-perfume-local",
    projectNames: ["人类香水 human-perfume"],
    deliverables: [
      { name: "human-perfume-local 提交包" },
    ],
  },
];

async function main() {
  const existing = await prisma.contest.count();
  if (existing > 0) {
    console.log(`已有 ${existing} 场比赛，跳过 seed`);
    return;
  }

  for (const sc of seedContests) {
    const contest = await prisma.contest.create({
      data: {
        name: sc.name,
        organizer: sc.organizer,
        track: sc.track,
        deadline: sc.deadline ?? "",
        status: sc.status,
        submitLink: sc.submitLink ?? "",
        notes: sc.notes ?? "",
        deliverables: {
          create: sc.deliverables.map((d) => ({
            name: d.name,
            done: d.done ?? false,
            doneAt: d.done ? new Date() : null,
          })),
        },
      },
    });

    await prisma.eventLog.create({
      data: {
        entityType: "contest",
        entityId: contest.id,
        action: "create",
        beforeJson: "{}",
        afterJson: JSON.stringify({ name: sc.name, status: sc.status, deliverables: sc.deliverables.length }),
      },
    });

    for (const pname of sc.projectNames) {
      const project = await prisma.project.findFirst({ where: { name: pname } });
      if (!project) {
        console.warn(`  ! 未找到项目「${pname}」，跳过关联（比赛：${sc.name}）`);
        continue;
      }
      const link = await prisma.contestProject.create({
        data: { contestId: contest.id, projectId: project.id },
      });
      await prisma.eventLog.create({
        data: {
          entityType: "contest_project",
          entityId: link.id,
          action: "create",
          beforeJson: "{}",
          afterJson: JSON.stringify({ contestName: sc.name, projectName: pname }),
        },
      });
    }
  }

  const total = await prisma.contest.count();
  const links = await prisma.contestProject.count();
  const delivs = await prisma.deliverable.count();
  console.log(`已写入 ${total} 场真实比赛 / ${links} 条项目关联 / ${delivs} 项交付物`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
