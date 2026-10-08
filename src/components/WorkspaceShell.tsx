"use client";

import { useCallback, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { AssistantDock } from "./AssistantDock";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// 竖向可拖分隔条（sash）。三栏都是它的 flex 兄弟，拖动只是此消彼长地改相邻栏宽度，
// 且各栏都设了 min-width 下限 —— 所以边框只会在 sash 处相接，结构上永不交叉 / 重叠。
function VSash({ onDelta, className = "" }: { onDelta: (dx: number) => void; className?: string }) {
  const last = useRef(0);
  const onDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      last.current = e.clientX;
      const move = (ev: PointerEvent) => {
        onDelta(ev.clientX - last.current);
        last.current = ev.clientX;
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    },
    [onDelta]
  );
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onDown}
      className={`group hidden w-1.5 shrink-0 cursor-col-resize items-stretch justify-center bg-transparent hover:bg-brand/5 active:bg-brand/10 ${className}`}
      title="拖动调整宽度"
    >
      <div className="my-2 w-px rounded-full bg-[#d7dbe2] transition-colors group-hover:bg-brand group-active:bg-brand" />
    </div>
  );
}

// 全站工作区骨架：侧栏 | 主内容 | AI 助手栏，宽屏三段并排、两条边框均可拖动，
// 窄屏（<md / <lg）自动回落为顶栏 + 纵向堆叠，逻辑与旧版一致。
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [sideW, setSideW] = useState(240); // 侧栏宽：180~360
  const [dockW, setDockW] = useState(360); // 助手栏宽：280~520

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar width={sideW} />
      <VSash className="md:flex" onDelta={(dx) => setSideW((w) => clamp(w + dx, 180, 360))} />

      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
        <VSash className="lg:flex" onDelta={(dx) => setDockW((w) => clamp(w - dx, 280, 520))} />
        <AssistantDock width={dockW} />
      </div>
    </div>
  );
}
