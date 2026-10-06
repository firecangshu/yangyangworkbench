/**
 * M30 连接卡种子：魔术师 + 调研工具入库（幂等：按 toolName 查找，有则更新、无则创建）。
 * 凭据只存 credentialRef 指向 credentials/ 文件，红线①：绝不写入 key 值本身。
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const CONNECTIONS = [
  {
    toolName: "黑客松路演魔术师",
    category: "contest-tool",
    entryUrl: "http://localhost:7860",
    accountNotes: "本地 Gradio · 无 token 自动降级演示",
    credentialRef: "credentials/modelscope-token.txt",
    launchCommand: 'python "E:\\2.黑客松魔术师\\hackathon-roadshow-magician-studio\\app.py"',
    status: "active",
    tags: "roadshow,magician,contest",
    notes: "在线体验 https://www.modelscope.cn/studios/firecangshu/hackathon-roadshow-magician",
  },
  {
    toolName: "横纵分析法调研",
    category: "contest-tool",
    entryUrl: "",
    accountNotes: "hv-analysis skill · 赛前选题/竞品调研",
    credentialRef: "",
    launchCommand: "",
    status: "active",
    tags: "research,hv-analysis",
    notes: "E:\\2.黑客松魔术师\\hv-analysis\\SKILL.md",
  },
  {
    toolName: "AI HOT 资讯",
    category: "contest-tool",
    entryUrl: "https://aihot.virxact.com",
    accountNotes: "aihot skill · 每日 AI 热点与趋势",
    credentialRef: "",
    launchCommand: "",
    status: "active",
    tags: "research,aihot",
    notes: "E:\\2.黑客松魔术师\\aihot\\SKILL.md",
  },
];

async function main() {
  for (const c of CONNECTIONS) {
    const existing = await prisma.connection.findFirst({ where: { toolName: c.toolName } });
    if (existing) {
      await prisma.connection.update({ where: { id: existing.id }, data: c });
      console.log(`updated: ${c.toolName} (id=${existing.id})`);
    } else {
      const created = await prisma.connection.create({ data: c });
      console.log(`created: ${c.toolName} (id=${created.id})`);
    }
  }
  console.log("M30_SEED_PASS");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
