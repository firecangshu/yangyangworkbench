"use client";

import { useEffect } from "react";

const KEY = "queetai-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const t = localStorage.getItem(KEY) || "industrial";
    document.documentElement.dataset.theme = t;
  }, []);
  return <>{children}</>;
}

export function setTheme(t: string) {
  localStorage.setItem(KEY, t);
  document.documentElement.dataset.theme = t;
}
