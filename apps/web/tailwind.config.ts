import type { Config } from "tailwindcss";

/**
 * X-Factor AS design system. The DEFAULT look is a dark ink-navy sidebar/header
 * with a LIGHT main-content area (matching the reference); a user toggle switches
 * the content to full dark. Mechanism: the `ink`/`slate` content tokens are CSS
 * variables (light values by default, dark under the `.dark` class — see
 * globals.css), so any component using them themes automatically. The sidebar/
 * header use the FIXED `nav` scale so they stay dark in both modes. `gold` (the
 * brand accent) is fixed. Palette values come from apps/marketing ("Midnight Scholar").
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Content surfaces/borders — theme-driven via CSS vars.
        ink: {
          950: "#070A14", // fixed: text/icon shown ON gold (dark in both modes)
          900: "var(--ink-900)", // page background
          850: "var(--ink-850)", // card / surface
          800: "var(--ink-800)", // hover surface
          700: "var(--ink-700)", // border
          600: "#283153", // fixed (logo stroke etc.)
          500: "#3A4570", // fixed
        },
        // Content text — theme-driven via CSS vars (dark text in light mode).
        slate: {
          100: "var(--slate-100)", // primary text
          200: "var(--slate-200)",
          300: "var(--slate-300)", // secondary
          400: "var(--slate-400)", // muted
          500: "var(--slate-500)", // faint
        },
        // The always-dark sidebar/header scale (never themed).
        nav: {
          bg: "#0B1020",
          surface: "#0F1528",
          hover: "#141B33",
          border: "#1C2542",
          text: "#AEB7CD",
          bright: "#E8EBF2",
          muted: "#9AA4BD",
        },
        gold: {
          200: "#F6E2B3",
          300: "#F0D08C",
          400: "#E8B64C", // primary accent
          500: "#D9A23A",
          600: "#B6822A", // legible gold for text/links on a LIGHT surface
        },
        // Warm "parchment" — the owner's PRIVATE columns (real charge + extra
        // margin). Fixed (semantic private highlight), not themed. (handoff §Design tokens)
        parchment: {
          DEFAULT: "#FBF7EC",
          surface: "#FFFDF6",
          border: "#EAD9AE",
          text: "#8A5F1D",
        },
        // Partner / cut / loan accent (design purple #6D3FC4). Named `plum` so it
        // does NOT clobber Tailwind's built-in `purple-*` (used raw on some pages).
        plum: {
          500: "#6D3FC4",
          bg: "#F0E9FB",
        },
        // Personal-Finance plane identity (teal). Named `pf` to avoid clobbering
        // Tailwind's default `teal-*`. Reinforces the walled-off PF boundary.
        pf: {
          900: "#0B3B33",
          700: "#0E5C50",
          600: "#0E7C6B",
          accent: "#7FE3CE",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
