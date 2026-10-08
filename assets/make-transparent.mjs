// 把白底 logo 源图处理成透明底图标源（M17）：
// 从四边泛洪填充标记"外部近白"区域 → alpha=0，主体内部白色（闪电）不受影响；
// 边界 1px 羽化防锯齿。用法: node assets/make-transparent.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";

const SRC = "assets/logo/app-icon-bolt-1024.png";
const OUT = "assets/logo/app-icon-bolt-1024-alpha.png";
const N = 1024;
// 可剔除判据：近白（亮度≥242）或低饱和（max-min通道差<60，盖住淡紫光晕带）。
// 主体渐变边缘饱和度高不会被吃；内部纯白闪电与背景不连通，泛洪到不了。
const { data } = await sharp(readFileSync(SRC)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

const removable = (i) => {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum >= 242 || Math.max(r, g, b) - Math.min(r, g, b) < 60;
};

// BFS 从四条边出发标记外连通域
const outside = new Uint8Array(N * N);
const queue = [];
for (let x = 0; x < N; x++) {
  for (const y of [0, N - 1]) if (removable(y * N + x) && !outside[y * N + x]) { outside[y * N + x] = 1; queue.push(y * N + x); }
}
for (let y = 0; y < N; y++) {
  for (const x of [0, N - 1]) if (removable(y * N + x) && !outside[y * N + x]) { outside[y * N + x] = 1; queue.push(y * N + x); }
}
while (queue.length) {
  const p = queue.pop();
  const x = p % N, y = (p - x) / N;
  const nb = [];
  if (x > 0) nb.push(p - 1);
  if (x < N - 1) nb.push(p + 1);
  if (y > 0) nb.push(p - N);
  if (y < N - 1) nb.push(p + N);
  for (const q of nb) if (!outside[q] && removable(q)) { outside[q] = 1; queue.push(q); }
}

// 形态学迭代收边：紧邻外域且仍属"弱像素"（近白或低饱和）的向内吃掉，直到收敛（清掉底部投影弧）
const weak = (p) => !outside[p] && removable(p);
for (let iter = 0; iter < 30; iter++) {
  const eatNow = [];
  for (let p = 0; p < N * N; p++) {
    if (!outside[p]) continue;
    const x = p % N, y = (p - x) / N;
    if (x > 0 && weak(p - 1)) eatNow.push(p - 1);
    if (x < N - 1 && weak(p + 1)) eatNow.push(p + 1);
    if (y > 0 && weak(p - N)) eatNow.push(p - N);
    if (y < N - 1 && weak(p + N)) eatNow.push(p + N);
  }
  if (eatNow.length === 0) break;
  for (const q of eatNow) outside[q] = 1; // 同轮重复标记无害，下轮 weak() 自动跳过
}

// 应用 alpha：外连通域=0；紧邻外域一圈的像素按饱和度羽化（饱和越高越实）
let cleared = 0;
for (let p = 0; p < N * N; p++) {
  if (outside[p]) { data[p * 4 + 3] = 0; cleared++; continue; }
  const x = p % N, y = (p - x) / N;
  const touches = (x > 0 && outside[p - 1]) || (x < N - 1 && outside[p + 1]) || (y > 0 && outside[p - N]) || (y < N - 1 && outside[p + N]);
  if (touches) {
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    data[p * 4 + 3] = Math.min(255, sat * 5); // sat≥51 即全不透明，淡紫残边→半透→透明
  }
}
console.log("cleared px:", cleared, "/", N * N);

const png = await sharp(data, { raw: { width: N, height: N, channels: 4 } }).png().toBuffer();
writeFileSync(OUT, png);
console.log("written:", OUT);
