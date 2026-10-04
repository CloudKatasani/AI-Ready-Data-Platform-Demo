/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), surface2: v('surface-2'), ink: v('ink'), muted: v('muted'),
        line: v('line'), accent: v('accent'), seal: v('seal'), good: v('good'), warn: v('warn'), bad: v('bad'),
        'l-bronze': v('layer-bronze'), 'l-silver': v('layer-silver'), 'l-gold': v('layer-gold'),
        'l-semantic': v('layer-semantic'), 'l-glossary': v('layer-glossary'), 'l-context': v('layer-context'),
        'l-product': v('layer-product'), 'l-agent': v('layer-agent'), 'l-gov': v('layer-gov'),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: { xs: ['12px', '16px'], sm: ['13px', '18px'], base: ['14px', '21px'], md: ['16px', '24px'], lg: ['20px', '28px'], xl: ['28px', '34px'] },
    },
  },
  plugins: [],
};
