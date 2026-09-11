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
        // 0077 visual pass. Purely additive — no existing class changes
        // meaning. "moss" is the muted forest green the trend arrows were
        // already using inline (#1F7A4D); naming it lets the meters, the two
        // headline percentages and the trend share one accent instead of three
        // hard-coded hexes. "clay" is the matching negative, also already in
        // use inline. The soft pair are the recessive tracks/washes they sit on.
        moss: "#1F7A4D",
        "moss-soft": "#E6EEE8",
        "moss-deep": "#175D3B",
        clay: "#AC3A2A",
        "clay-soft": "#F2E4E1",
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
