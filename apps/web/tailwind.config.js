/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-aware: these resolve through CSS variables defined in index.css
        // (`:root` for dark, `[data-theme="light"]` override) so existing class names
        // like `bg-ink-950`/`text-amber-300` work unchanged in both themes -- only the
        // dark/light *value* differs. Shades not listed (e.g. amber-50/100/200,
        // red-*) aren't theme-overridden and keep Tailwind's stock palette.
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)", 100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)", 300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)", 500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)", 700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)", 900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
        amber: {
          50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a",
          300: "rgb(var(--amber-300) / <alpha-value>)", 400: "rgb(var(--amber-400) / <alpha-value>)",
          500: "rgb(var(--amber-500) / <alpha-value>)", 600: "#d97706", 700: "#b45309",
          800: "#92400e", 900: "#78350f",
        },
        red: {
          200: "rgb(var(--red-200) / <alpha-value>)", 300: "rgb(var(--red-300) / <alpha-value>)",
          400: "rgb(var(--red-400) / <alpha-value>)", 500: "rgb(var(--red-500) / <alpha-value>)",
        },
        ink: {
          50: "rgb(var(--ink-50) / <alpha-value>)", 100: "rgb(var(--ink-100) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)", 300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)", 500: "rgb(var(--ink-500) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)", 700: "rgb(var(--ink-700) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)", 900: "rgb(var(--ink-900) / <alpha-value>)",
          950: "rgb(var(--ink-950) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Space Grotesk", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -8px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(30,166,150,0.4), 0 0 22px -4px rgba(30,166,150,0.6)",
        "glow-amber": "0 0 0 1px rgba(245,158,11,0.4), 0 0 22px -4px rgba(245,158,11,0.6)",
        "glow-red": "0 0 0 1px rgba(239,68,68,0.4), 0 0 22px -4px rgba(239,68,68,0.6)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgb(var(--grid-line) / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--grid-line) / 0.035) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
