"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { darkTheme, lightTheme } from "@/theme/mui-theme";

/* The theme source of truth stays in the existing preference system: the
 * pre-hydration script and PreferenceSync toggle `.dark` on <html>, and MUI
 * only follows that class — no parallel color-scheme machinery. */
function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const dark = useDarkMode();
  return <ThemeProvider theme={dark ? darkTheme : lightTheme}>{children}</ThemeProvider>;
}
