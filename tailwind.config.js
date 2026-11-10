/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /*
         * Shell surfaces. `surface` is the chrome (toolbars, panel headers),
         * `canvas` is the editor sheet, `overlay` is the modal scrim. They are
         * separate tokens so a dark shell can recess the sheet below the chrome
         * without ever inverting text inside a panel.
         */
        surface: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
        },
        "surface-variant": {
          DEFAULT: "hsl(var(--surface-variant))",
          foreground: "hsl(var(--surface-variant-foreground))",
        },
        canvas: {
          DEFAULT: "hsl(var(--canvas))",
          foreground: "hsl(var(--canvas-foreground))",
        },
        overlay: {
          DEFAULT: "hsl(var(--overlay))",
          foreground: "hsl(var(--overlay-foreground))",
        },
        // Semantic status. Each has a matching `-foreground` that is verified
        // against it by the theme contrast test.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        // Editor palette
        grid: "hsl(var(--grid))",
        "grid-major": "hsl(var(--grid-major))",
        wire: "hsl(var(--wire))",
        bus: "hsl(var(--bus))",
        symbol: "hsl(var(--symbol))",
        pin: "hsl(var(--pin))",
        junction: "hsl(var(--junction))",
        selection: "hsl(var(--selection))",
        cursor: "hsl(var(--hover))",
        "net-label": "hsl(var(--net-label))",
        "ref-label": "hsl(var(--reference-label))",
        "value-label": "hsl(var(--value-label))",
        // Structural force sign: tension, compression, and a member carrying none.
        "force-tension": "hsl(var(--force-tension))",
        "force-compression": "hsl(var(--force-compression))",
        "force-neutral": "hsl(var(--force-neutral))",
        /*
         * Chart series. Recharts needs literal colour strings for SVG attributes,
         * so panels resolve these from the active theme at render time rather
         * than relying on `var()` inside a presentation attribute.
         */
        /*
         * Syntax roles. `src/components/editor/CodeEditor.tsx` colours a deck or
         * a module with these, and `SYNTAX_TOKEN_NAMES` in tokens.ts contracts
         * every one of them against both code surfaces.
         */
        syntax: {
          keyword: "hsl(var(--syntax-keyword))",
          type: "hsl(var(--syntax-type))",
          string: "hsl(var(--syntax-string))",
          number: "hsl(var(--syntax-number))",
          comment: "hsl(var(--syntax-comment))",
          operator: "hsl(var(--syntax-operator))",
          preproc: "hsl(var(--syntax-preproc))",
          builtin: "hsl(var(--syntax-builtin))",
        },

        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // One scale, not two: `--radius` sets the step, so a dialog (`rounded-xl`)
        // and a field (`rounded-sm`) always read as members of the same family.
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      /*
       * Elevation. Tailwind's stock shadows are fixed black, which turns muddy on
       * a navy shell and vanishes on a white one, so every level is painted from
       * `--shadow-color` — the same token `src/lib/theme/tokens.ts` verifies.
       * Each level carries three layers: a lit top edge (`--panel-edge`, which an
       * appearance with no decoration sets to zero), a contact shadow, and an
       * ambient one. That is what makes a panel look lifted off the sheet rather
       * than outlined.
       */
      boxShadow: {
        sm: "inset 0 1px 0 hsl(var(--foreground) / var(--panel-edge)), 0 1px 2px -1px hsl(var(--shadow-color) / 0.35), 0 1px 3px -1px hsl(var(--shadow-color) / 0.25)",
        DEFAULT:
          "inset 0 1px 0 hsl(var(--foreground) / var(--panel-edge)), 0 2px 4px -2px hsl(var(--shadow-color) / 0.35), 0 4px 12px -4px hsl(var(--shadow-color) / 0.28)",
        md: "inset 0 1px 0 hsl(var(--foreground) / var(--panel-edge)), 0 4px 8px -3px hsl(var(--shadow-color) / 0.38), 0 8px 20px -6px hsl(var(--shadow-color) / 0.30)",
        lg: "inset 0 1px 0 hsl(var(--foreground) / var(--panel-edge)), 0 8px 16px -6px hsl(var(--shadow-color) / 0.40), 0 16px 34px -10px hsl(var(--shadow-color) / 0.34)",
        xl: "inset 0 1px 0 hsl(var(--foreground) / var(--panel-edge)), 0 12px 24px -8px hsl(var(--shadow-color) / 0.45), 0 28px 56px -14px hsl(var(--shadow-color) / 0.40)",
        "2xl": "inset 0 1px 0 hsl(var(--foreground) / var(--panel-edge)), 0 20px 40px -12px hsl(var(--shadow-color) / 0.50), 0 44px 88px -20px hsl(var(--shadow-color) / 0.46)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "slide-in": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.33)" },
          "40%, 50%": { opacity: 1 },
          "100%": { opacity: 0, transform: "scale(1.33)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s ease-in-out",
        "slide-in": "slide-in 0.3s ease-out",
        "pulse-ring": "pulse-ring 1.5s ease-out infinite",
      },
      fontFamily: {
        // The UI is set in Inter (bundled, variable): one family across labels,
        // titles, controls and data, so hierarchy comes from size/weight/colour
        // instead of from switching typefaces.
        sans: [
          "InterVariable",
          "Inter",
          "Segoe UI Variable Text",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // Mono is reserved for code, netlists and keycaps — the places where a
        // fixed advance is information, not decoration.
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Cascadia Mono",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      spacing: {
        "18": "4.5rem",
        "88": "22rem",
      },
      zIndex: {
        "60": "60",
        "70": "70",
        "80": "80",
        "90": "90",
        "100": "100",
      },
    },
  },
  plugins: [],
};
