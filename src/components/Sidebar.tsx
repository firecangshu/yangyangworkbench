"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "仪表盘", icon: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" },
  { href: "/projects", label: "项目中枢", icon: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" },
  { href: "/contests", label: "比赛追踪", icon: "M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" },
  { href: "/connections", label: "连接中心", icon: "M9 7V3m6 4V3M6 7h12v4a6 6 0 0 1-12 0V7Zm3 12h6" },
  { href: "/log", label: "操作流水", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { href: "/settings", label: "设置", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 2h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
      <path d={d} />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* 桌面侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 flex-col bg-sidebar text-sidebar-fg md:flex">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white">杨</span>
          <div>
            <div className="text-lg font-semibold leading-tight">杨杨的AI比赛专用工作台</div>
            <div className="text-[11px] text-sidebar-fg/60">连接本地与程序的中枢</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                isActive(l.href) ? "bg-brand font-medium text-white" : "text-sidebar-fg/80 hover:bg-white/10"
              }`}>
              <Icon d={l.icon} />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 pb-5 text-[11px] text-sidebar-fg/50">
          <div>M16 · 本地优先 · 数据在本机</div>
          <div className="mt-0.5">晨报 8:30 · 备份 21:00</div>
        </div>
      </aside>

      {/* 小屏顶部条 */}
      <div className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b bg-sidebar px-3 py-2 text-sidebar-fg md:hidden">
        <span className="mr-2 flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">雀</span>
        {links.map((l) => (
          <Link key={l.href} href={l.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${
              isActive(l.href) ? "bg-brand text-white" : "text-sidebar-fg/80"
            }`}>
            <Icon d={l.icon} />
            {l.label}
          </Link>
        ))}
      </div>
    </>
  );
}
