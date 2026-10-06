// M29.1 迁移哨兵：验证 coerceColSpan 的旧 size→colSpan 映射、clamp、脏值回落（跑法：npx tsx scripts/layout-migrate-check.mts）
import { coerceColSpan } from "../src/lib/dashboard-layout.ts";
import assert from "node:assert";

// 旧 size 档位 → 列数映射
assert.equal(coerceColSpan(undefined, "full", 12), 12);
assert.equal(coerceColSpan(undefined, "twoThirds", 12), 8);
assert.equal(coerceColSpan(undefined, "half", 12), 6);
assert.equal(coerceColSpan(undefined, "third", 12), 4);
// 新 colSpan 优先 + clamp / 四舍五入
assert.equal(coerceColSpan(8, "full", 12), 8);
assert.equal(coerceColSpan(0, "half", 12), 1);
assert.equal(coerceColSpan(99, undefined, 12), 12);
assert.equal(coerceColSpan(5.4, undefined, 12), 5);
// 都缺 → 默认；脏值 → 默认
assert.equal(coerceColSpan(undefined, undefined, 6), 6);
assert.equal(coerceColSpan("x" as unknown as number, undefined, 12), 12);
console.log("LAYOUT_MIGRATE_PASS");
