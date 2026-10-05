import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

/**
 * 云端模型调用测试。
 * 安全设计：API key 不入库、不回传——只从本地凭据引用文件读取，调用后仅返回状态与摘要。
 * 配置：
 *   body = { baseUrl, model, credentialRef, prompt }
 *   credentialRef 为本地文件路径，文件内第一行或整个内容为 key
 */
export async function POST(req: Request) {
  const body = await req.json();
  const baseUrl = String(body.baseUrl ?? "").trim();
  const model = String(body.model ?? "glm-4.5-air").trim();
  const credentialRef = String(body.credentialRef ?? "").trim();
  const prompt = String(body.prompt ?? "你好，请用一句话回复确认你在线。").trim();

  if (!baseUrl || !credentialRef) {
    return NextResponse.json(
      { ok: false, error: "baseUrl 与 credentialRef（本地 key 文件路径）均为必填" },
      { status: 400 }
    );
  }
  if (!existsSync(credentialRef)) {
    return NextResponse.json(
      { ok: false, error: `凭据文件不存在：${credentialRef}。请先把 API key 写入该本地文件（key 不经过雀台数据库）。`, stage: "credential_missing" },
      { status: 400 }
    );
  }

  let apiKey = "";
  try {
    const raw = await readFile(credentialRef, "utf-8");
    apiKey = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? "";
  } catch (e) {
    return NextResponse.json({ ok: false, error: `读取凭据文件失败：${String(e)}`, stage: "credential_read" }, { status: 500 });
  }
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "凭据文件为空", stage: "credential_empty" }, { status: 400 });
  }

  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const elapsed = Date.now() - started;
    const text = await res.text();
    let reply: string | null = null;
    let tokens: unknown = null;
    try {
      const json = JSON.parse(text);
      reply = json?.choices?.[0]?.message?.content ?? null;
      tokens = json?.usage ?? null;
    } catch { /* 非 JSON 响应 */ }
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      elapsedMs: elapsed,
      model,
      reply,
      usage: tokens,
      note: "API key 未出库、未回传；仅在本进程内存中使用一次",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `调用失败：${String(e)}`, stage: "request", elapsedMs: Date.now() - started },
      { status: 502 }
    );
  }
}
