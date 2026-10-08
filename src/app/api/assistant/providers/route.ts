import { NextResponse } from "next/server";
import { ASSISTANT_PROVIDERS, readKey } from "@/lib/assistant";

/** 助手模型清单（M17）：GET /api/assistant/providers —— 只报「key 是否已配」，不回显 key */
export async function GET() {
  const providers = await Promise.all(
    ASSISTANT_PROVIDERS.map(async (p) => ({
      id: p.id,
      label: p.label,
      model: p.model,
      note: p.note,
      keyFile: p.keyFile,
      vision: p.vision === true,
      hasKey: (await readKey(p.keyFile)) !== null,
    }))
  );
  return NextResponse.json(providers);
}
