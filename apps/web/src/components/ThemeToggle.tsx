"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Light/dark toggle for the main-content area (the sidebar/header stay dark). The
 * default is LIGHT content; the choice persists in localStorage under `xfas-theme`
 * and is applied by toggling `.dark` on <html>. The inline script in layout.tsx
 * applies the saved choice before paint (no flash).
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("xfas-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-nav-text hover:bg-nav-hover hover:text-nav-bright"
    >
      {dark ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
    </button>
  );
}
