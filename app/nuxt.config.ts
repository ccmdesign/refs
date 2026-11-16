import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// The house design system (github.com/claudioccm/ccm-labs-design-system): app/assets/main.css imports its
// stylesheet and holds only what is _refs's own. Its theme-init.js applies a stored light or dark choice
// before first paint, so it is inlined in the head.
const themeInit = readFileSync(
  createRequire(import.meta.url).resolve("ccm-labs-design-system/theme-init.js"),
  "utf8",
);

export default defineNuxtConfig({
  ssr: false,
  // Baked in so the bundled server can find app/ and ../library.
  runtimeConfig: { appDir: root },
  compatibilityDate: "2024-11-01",
  devServer: {
    port: Number(process.env.REFS_PORT) || 3210,
  },
  modules: ["@nuxt/fonts"],
  fonts: {
    families: [
      {
        name: "Switzer",
        provider: "fontshare",
        weights: [400, 500, 600],
      },
      // The display face: the view title, the app name, a panel's title.
      {
        name: "Montagu Slab",
        provider: "google",
        weights: [300],
      },
    ],
  },
  app: {
    head: {
      title: "_refs",
      // A dense tool: the design system's smaller type scale.
      htmlAttrs: { lang: "en", "data-density": "tool" },
      meta: [{ name: "color-scheme", content: "light dark" }],
      // Set the theme before first paint so a dark page never flashes white. The choice is kept under the
      // design system's key (cm-theme); one saved under the old key (refs-theme) is carried over once.
      script: [
        {
          innerHTML:
            'try{var t=localStorage.getItem("refs-theme");if(t){if(t==="light"||t==="dark")localStorage.setItem("cm-theme",t);localStorage.removeItem("refs-theme")}}catch(e){}',
        },
        { innerHTML: themeInit },
      ],
    },
  },
  // main.css imports the design system first, then holds what is _refs's own.
  css: ["~/assets/main.css"],
  vue: {
    // <cm-theme-toggle> and the system's other elements are custom elements, not Vue components.
    compilerOptions: { isCustomElement: (tag: string) => tag.startsWith("cm-") },
  },
  alias: {
    "~~": root,
  },
  nitro: {
    alias: {
      "~~": root,
    },
  },
});
