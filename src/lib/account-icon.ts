/**
 * 账号徽章图标生成（M36.2）：给定颜色 → 一个圆形徽章 .ico，供桌面快捷方式使用。
 *
 * 为什么手写 PNG/ICO 而不复用 assets/make-ico.mjs：那个是离线构建脚本，用 sharp
 * 缩放源图；这里要在服务端**运行时**按颜色现生成，不该把 sharp 拉进运行链路。
 * 图形本身只有圆和环，纯数学就能算，只需要 Node 内置的 zlib。
 *
 * 为什么是圆形 + 白色圆环 + 中心白点：任务栏和桌面上图标只有 16~32px，
 * 色块加白环在小尺寸下最容易分辨颜色，中心白点保证「不是个空圆」。
 *
 * ICO 采用 PNG 内嵌条目（Vista+ 原生支持），尺寸档位 32 与 256，
 * 256 在目录项里宽高写 0——这是 ICO 规范的规定，不是 bug。
 */
import { deflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** 标准 CRC32（多项式 0xEDB88320），crc32("123456789") 应为 0xCBF43926 */
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

/** #RRGGBB → 数值；写坏了不抛异常，回落到中性灰（图标坏总比整个启动流程崩好） */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  if (!m) return { r: 107, g: 114, b: 128 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** RGBA 像素（未预乘，PNG 直接可用）。3x3 超采样求圆边覆盖率，避免锯齿 */
export function renderBadge(hex: string, size: number): Buffer {
  const { r, g, b } = parseHex(hex);
  const s = Math.max(8, Math.min(256, Math.trunc(size) || 32));
  const px = Buffer.alloc(s * s * 4);
  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const R = s / 2 - Math.max(0.5, s * 0.04);
  const ringR = R * 0.62;
  const ringW = Math.max(1.2, s * 0.1);
  const dotR = R * 0.2;
  const SUB = 3;
  const total = SUB * SUB;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let hit = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const dx = x + (sx + 0.5) / SUB - cx;
          const dy = y + (sy + 0.5) / SUB - cy;
          if (dx * dx + dy * dy <= R * R) hit++;
        }
      }
      const alpha = Math.round((hit / total) * 255);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const white = Math.abs(d - ringR) <= ringW / 2 || d <= dotR;
      const o = (y * s + x) * 4;
      if (white) {
        px[o] = 255;
        px[o + 1] = 255;
        px[o + 2] = 255;
      } else {
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
      }
      px[o + 3] = alpha;
    }
  }
  return px;
}

/** 真 PNG：签名 + IHDR + 单块 IDAT（filter 全 0）+ IEND */
export function encodePng(rgba: Buffer, size: number): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type: None
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const ICO_SIZES = [32, 256];

/** 组一个多尺寸 .ico：6 字节头 + 每项 16 字节目录 + PNG 数据 */
export function buildAccountIco(hex: string): Buffer {
  const parts = ICO_SIZES.map((s) => ({ s, png: encodePng(renderBadge(hex, s), s) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // type = icon
  head.writeUInt16LE(parts.length, 4);

  let offset = 6 + 16 * parts.length;
  const entries: Buffer[] = [];
  for (const { s, png } of parts) {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // 32bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([head, ...entries, ...parts.map((p) => p.png)]);
}
