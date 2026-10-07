import { NextResponse } from "next/server";

/**
 * POST /api/assistant/upload
 * 读取用户上传的文件，提取文本内容供 AI 助手分析。
 * 支持：文本文件（直接读 UTF-8）、图片（转 base64 data URL）。
 * 不存磁盘——只在内存中读取后返回（红线④不上传）。
 */

const TEXT_EXTS = new Set(["txt", "md", "csv", "json", "tsv", "log", "yaml", "yml", "xml", "html", "css", "js", "ts", "py", "mjs"]);
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
// 图片要 base64 内联进发给模型的 JSON（体积再放大 4/3），上游会直接拒，所以单独卡更紧
const MAX_IMG = 2 * 1024 * 1024; // 2MB

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "没有文件" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: `文件太大（${(file.size / 1024 / 1024).toFixed(1)}MB，上限 5MB）` }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const name = file.name;

  // 图片：转 base64 data URL（支持 vision 模型）
  if (IMG_EXTS.has(ext)) {
    if (file.size > MAX_IMG) {
      return NextResponse.json({ error: `图片太大（${(file.size / 1024 / 1024).toFixed(1)}MB，识图上限 2MB），请截图局部或压缩后再传` }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/png";
    const b64 = buf.toString("base64");
    return NextResponse.json({
      ok: true, name, size: file.size, type: "image", mime,
      content: `[图片: ${name}]`,
      dataUrl: `data:${mime};base64,${b64}`,
    });
  }

  // 文本文件：直接读 UTF-8
  if (TEXT_EXTS.has(ext) || !ext) {
    const text = await file.text();
    const truncated = text.length > 20000;
    return NextResponse.json({
      ok: true, name, size: file.size, type: "text",
      content: truncated ? text.slice(0, 20000) + "\n\n...（文件过长，已截断前 20000 字符）" : text,
    });
  }

  // PDF 等二进制：提示暂不支持
  if (ext === "pdf") {
    return NextResponse.json({ error: "PDF 暂不支持，请复制文本内容后粘贴" }, { status: 400 });
  }

  return NextResponse.json({ error: `不支持的文件类型 .${ext}。支持：文本/图片/PDF（暂不支持）` }, { status: 400 });
}
