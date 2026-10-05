// 多尺寸 .ico 打包器：源图（SVG/PNG 皆可）→ sharp 缩放 → PNG 内嵌 ICO 容器（Vista+ 标准）
// 用法: node assets/make-ico.mjs
// M17 定稿：紫青闪电（豆包设计，用户拍板）；源图白底已经 make-transparent.mjs 抠成透明；
// 完整重建链：先 node assets/make-transparent.mjs 再跑本脚本。旧 C2 方案源在 assets/logo/concepts/ 可回退
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";

const SRC = "assets/logo/app-icon-bolt-1024-alpha.png";
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngs = [];
for (const s of SIZES) {
  const buf = await sharp(readFileSync(SRC)).resize(s, s).png().toBuffer();
  pngs.push({ size: s, buf });
}

// ICO: HEADER(6) + ENTRIES(16*n) + PNG 数据
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // reserved
header.writeUInt16LE(1, 2);          // type = icon
header.writeUInt16LE(pngs.length, 4);

const entries = [];
let offset = 6 + 16 * pngs.length;
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0);      // width (0 = 256)
  e.writeUInt8(size >= 256 ? 0 : size, 1);      // height
  e.writeUInt8(0, 2);                            // colors
  e.writeUInt8(0, 3);                            // reserved
  e.writeUInt16LE(1, 4);                         // planes
  e.writeUInt16LE(32, 6);                        // bpp
  e.writeUInt32LE(buf.length, 8);                // size of image
  e.writeUInt32LE(offset, 12);                   // data offset
  entries.push(e);
  offset += buf.length;
}

mkdirSync("assets/icons", { recursive: true });
writeFileSync("assets/icons/app.ico", Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]));

// 浏览器/Edge 用 favicon（512 PNG）+ 同步到 Next.js 约定位 src/app/icon.png
await sharp(readFileSync(SRC)).resize(512, 512).png().toFile("assets/icons/app-512.png");
copyFileSync("assets/icons/app-512.png", "src/app/icon.png");
console.log("app.ico + app-512.png + src/app/icon.png generated");
