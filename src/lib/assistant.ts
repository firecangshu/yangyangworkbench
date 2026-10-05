/**
 * AI 助手模型注册表（M17）：多家免费/低价 LLM 轮替 = 多重保障。
 * 全部走 OpenAI 兼容 /chat/completions 格式，一份调用逻辑通吃。
 * 红线①：本文件只登记 key 的【本地文件路径】，绝不写 key 本身；
 *         key 放 credentials/<provider>-api-key.txt，一行即可。
 */
export type AssistantProvider = {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  keyFile: string;
  note: string;
};

export const ASSISTANT_PROVIDERS: AssistantProvider[] = [
  {
    id: "glm",
    label: "智谱 GLM-4-Flash（免费）",
    model: "glm-4-flash",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    keyFile: "credentials/glm-api-key.txt",
    note: "默认首选 · open.bigmodel.cn 注册即得免费 key",
  },
  {
    id: "deepseek",
    label: "DeepSeek Chat（低价备用）",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    keyFile: "credentials/deepseek-api-key.txt",
    note: "coding.deepseek.com 申请 · 一家限流切这家",
  },
  {
    id: "moonshot",
    label: "Kimi Moonshot（备用）",
    model: "moonshot-v1-8k",
    baseUrl: "https://api.moonshot.cn/v1",
    keyFile: "credentials/moonshot-api-key.txt",
    note: "platform.moonshot.cn 申请 · 送代金券",
  },
];

export function getProvider(id: string): AssistantProvider | undefined {
  return ASSISTANT_PROVIDERS.find((p) => p.id === id);
}

/** 读本地 key 文件（红线①：只从磁盘读，不经数据库、不进 git） */
export async function readKey(keyFile: string): Promise<string | null> {
  try {
    const { readFile } = await import("fs/promises");
    const key = (await readFile(keyFile, "utf-8")).trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}
