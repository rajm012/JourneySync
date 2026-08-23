/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Every colour resolves to a token in globals.css, so light/dark and
        // presentation mode all move from one place.
        paper: {
          DEFAULT: "var(--paper)",
          raised: "var(--paper-raised)",
          sunk: "var(--paper-sunk)",
          band: "var(--paper-band)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          band: "var(--ink-band)",
        },
        rule: {
          DEFAULT: "var(--rule)",
          strong: "var(--rule-strong)",
        },
        amex: {
          DEFAULT: "var(--blue)",
          deep: "var(--blue-deep)",
          ink: "var(--blue-ink)",
        },
        // The only warm hues in the product. If it's warm, a human is needed.
        flag: {
          DEFAULT: "var(--flag)",
          2: "var(--flag-2)",
        },
        ok: "var(--ok)",
        // Channel ramp: one family, ordered dark → light. Fills only, never text.
        channel: {
          web: "var(--ch-web)",
          app: "var(--ch-app)",
          call: "var(--ch-call)",
          branch: "var(--ch-branch)",
          email: "var(--ch-email)",
          sms: "var(--ch-sms)",
          none: "var(--ch-none)",
        },
      },
      fontFamily: {
        sans: ["var(--font-display)"],
        figure: ["var(--font-figure)"],
      },
      borderRadius: {
        DEFAULT: "3px",
      },
    },
  },
  plugins: [],
};
