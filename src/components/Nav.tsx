"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "仪表盘" },
  { href: "/projects", label: "项目中枢" },
  { href: "/contests", label: "比赛追踪" },
  { href: "/connections", label: "连接中心" },
  { href: "/log", label: "操作流水" },
  { href: "/settings", label: "设置" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            雀
          </span>
          <span className="text-lg font-semibold tracking-wide">雀台</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">M6</span>
        </div>
        <nav className="flex flex-wrap gap-1">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm transition ${
                  active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
