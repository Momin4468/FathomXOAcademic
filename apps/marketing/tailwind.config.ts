import type { Config } from "tailwindcss";

/**
 * "Midnight Scholar" design system — deep ink-navy base, warm gold accent,
 * serif display (Fraunces) + clean sans body (Inter). Premium, discreet, global.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070A14",
          900: "#0B1020", // page base
          850: "#0F1528",
          800: "#141B33",
          700: "#1C2542",
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
          400: "#9AA4BD", // secondary/micro copy (AA-passing on ink-900/850)
          500: "#9AA4BD", // alias so any stray text-slate-500 stays legible
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Fraunces", "Georgia", "serif"],
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },
      maxWidth: {
        container: "72rem",
      },
      boxShadow: {
        glow: "0 0 60px -12px rgba(232,182,76,0.35)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.6)",
      },
      keyframes: {
        spinslow: { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        fadeup: { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        spinslow: "spinslow 70s linear infinite",
        floaty: "floaty 6s ease-in-out infinite",
        fadeup: "fadeup 0.6s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
