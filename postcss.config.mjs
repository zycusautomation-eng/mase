/** PostCSS config — Tailwind v4 via its dedicated PostCSS plugin.
 *  NOTE: this only wires the Tailwind PIPELINE. The actual stylesheet
 *  (app/tailwind.css) deliberately imports theme + utilities but NOT
 *  preflight, so Tailwind's global reset never touches the existing
 *  custom-CSS pages (Deals/Espresso/Matcha/Admin). */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
