import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AssistantDock } from "@/components/AssistantDock";

export const metadata: Metadata = {
  title: "杨杨的AI比赛专用工作台",
  description: "本地优先的 AI 创作项目 / 比赛 / 工具中枢",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen">
        <ThemeProvider>
          <div className="md:pl-60">
            <Sidebar />
            <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
          </div>
          <AssistantDock />
        </ThemeProvider>
      </body>
    </html>
  );
}
