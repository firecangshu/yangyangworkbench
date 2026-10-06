import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { WorkspaceShell } from "@/components/WorkspaceShell";

export const metadata: Metadata = {
  title: "杨杨的工作台",
  description: "本地优先的 AI 创作项目 / 比赛 / 工具中枢",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen">
        <ThemeProvider>
          <WorkspaceShell>{children}</WorkspaceShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
