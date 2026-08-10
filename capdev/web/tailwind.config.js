/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Carried from the approved editorial design system. Not decoration —
      // adoption is the primary failure mode of QA platforms.
      colors: {
        ground: "#E9EAE3",
        "ground-2": "#DFE1D8",
        card: "#FBFBF8",
        ink: "#16211D",
        "ink-70": "#42504A",
        "ink-45": "#6F7A73",
        rule: "#CBCEC2",
        "rule-soft": "#DEE0D6",
        accent: "#33389E",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "3px" },
    },
  },
  plugins: [],
};
