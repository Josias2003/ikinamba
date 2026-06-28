/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefcfa", 100: "#d4f6f1", 200: "#aeece3", 300: "#79dccf",
          400: "#42c4b3", 500: "#1ea696", 600: "#13847a", 700: "#136963",
          800: "#15534f", 900: "#154543", 950: "#062a29",
        },
        amber: {
          50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d",
          400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309",
          800: "#92400e", 900: "#78350f",
        },
        ink: {
          50: "#f3f5f6", 100: "#e3e8ea", 200: "#c3ccd1", 300: "#9aa7ae",
          400: "#71828b", 500: "#566873", 600: "#44535c", 700: "#39454c",
          800: "#252e33", 900: "#161c1f", 950: "#0a0d0e",
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
        grid: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
