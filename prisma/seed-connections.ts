import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 入口 URL 无确切把握的留空 + 备注说明，不脑补
const seedConnections = [
  {
    toolName: "Cherry Studio",
    category: "chat",
    entryUrl: "https://www.cherry-ai.com",
    accountNotes: "多模型统一客户端：云端 API 与本地模型（Ollama）一个界面切换，key 存本机",
    credentialRef: "Cherry Studio 应用内设置 → 模型服务商",
    tags: "模型,多账号,本地+云",
    notes: "外接高星工具 ~50k★，负责模型调用与账号切换，雀台不重复造轮子",
  },
  {
    toolName: "Vaultwarden",
    category: "vault",
    entryUrl: "",
    accountNotes: "密码/API key 保险库（Bitwarden 兼容，Docker 自托管）",
    credentialRef: "待部署：部署后此处填本机服务地址",
    tags: "密码,凭据",
    notes: "外接高星工具 ~66k★；雀台各工具的 credentialRef 应逐步指向 Vaultwarden 条目",
  },
  {
    toolName: "Loomy",
    category: "chat",
    entryUrl: "",
    accountNotes: "本地版 AI 助手，数据存本机公共目录",
    credentialRef: "Loomy 设置页",
    tags: "助手,本地版",
    notes: "主力对话/自动化工具",
  },
  {
    toolName: "CodeBuddy",
    category: "coding",
    entryUrl: "https://codebuddy.tencent.com",
    accountNotes: "腾讯 AI 编程工具；跨账号数据持久化方案已定型",
    credentialRef: "CodeBuddy 应用内登录",
    tags: "编程,腾讯",
    notes: "E:\\codebuddy 与 E:\\Documents 下均有数据痕迹",
  },
  {
    toolName: "Qoder",
    category: "coding",
    entryUrl: "",
    accountNotes: "阿里 AI 编程工具",
    credentialRef: "Qoder 应用内登录",
    tags: "编程,阿里",
    notes: "本机装有 Qoder-cn",
  },
  {
    toolName: "TRAE",
    category: "coding",
    entryUrl: "https://www.trae.cn",
    accountNotes: "字节 AI 编程工具（TRAE SOLO CN）",
    credentialRef: "TRAE 应用内登录",
    tags: "编程,字节",
    notes: "本机装有 TRAE SOLO CN；有参赛版本 fusang-tree 项目",
  },
  {
    toolName: "讯飞开放平台",
    category: "platform",
    entryUrl: "https://www.xfyun.cn",
    accountNotes: "讯飞比赛与 SkillHub 发布入口",
    credentialRef: "讯飞开放平台账号",
    tags: "比赛,平台,skill",
    notes: "12 赛道 Skill 比赛已全部投完；门神等 skill 在此发布",
  },
  {
    toolName: "ModelScope 魔搭",
    category: "platform",
    entryUrl: "https://www.modelscope.cn",
    accountNotes: "ModelScope Intel+OpenVINO 比赛入口",
    credentialRef: "ModelScope 账号",
    tags: "比赛,平台",
    notes: "人类香水本地推理版参赛平台",
  },
  {
    toolName: "GitHub",
    category: "platform",
    entryUrl: "https://github.com",
    accountNotes: "开源仓库托管；雀台规划参考 apache/maka 亦源于此",
    credentialRef: "GitHub 账号",
    tags: "开源,代码",
    notes: "skill 项目与比赛工程的代码归档处",
  },
  {
    toolName: "SkillHub",
    category: "platform",
    entryUrl: "",
    accountNotes: "讯飞 Skill 平台，参赛须经赛题页面提交",
    credentialRef: "经讯飞开放平台进入",
    tags: "skill,发布,比赛",
    notes: "发布规则：同名硬约束、文件扩展名白名单、Pay Skill 支付协议关键词",
  },
];

async function main() {
  const existing = await prisma.connection.count();
  if (existing > 0) {
    console.log(`已有 ${existing} 个连接，跳过 seed`);
    return;
  }
  for (const c of seedConnections) {
    const created = await prisma.connection.create({ data: c });
    await prisma.eventLog.create({
      data: {
        entityType: "connection",
        entityId: created.id,
        action: "create",
        beforeJson: "{}",
        afterJson: JSON.stringify({ toolName: c.toolName, category: c.category }),
      },
    });
  }
  console.log(`已写入 ${seedConnections.length} 个工具连接`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
