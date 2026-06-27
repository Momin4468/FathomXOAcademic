import type { Config } from "tailwindcss";

// Base Tailwind config. shadcn/ui tokens/components are layered in a later round
// (the visual design language is intentionally deferred — CLAUDE.md §4, spec §10).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
