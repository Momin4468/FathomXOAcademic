import type { Config } from "tailwindcss";

/**
 * X-Factor AS design system — the marketing site's "Midnight Scholar" palette,
 * shared so the internal tool and the public site read as one product: a deep
 * ink-navy base (NOT black), a warm gold accent, serif display (Fraunces) + clean
 * sans body (Inter). Values are copied verbatim from apps/marketing/tailwind.config.ts.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070A14",
          900: "#0B1020", // page base
          850: "#0F1528", // card / surface
          800: "#141B33", // elevated / hover
          700: "#1C2542", // border
          600: "#283153",
          500: "#3A4570",
        },
        gold: {
          200: "#F6E2B3",
          300: "#F0D08C",
          400: "#E8B64C", // primary accent
          500: "#D9A23A",
          600: "#B6822A",
        },
        slate: {
          100: "#E8EBF2",
          200: "#CBD2E0",
          300: "#AEB7CD", // body copy (AA on the ink base)
          400: "#9AA4BD", // secondary / micro copy (AA on ink-900/850)
          500: "#9AA4BD", // alias so any stray text-slate-500 stays legible
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
