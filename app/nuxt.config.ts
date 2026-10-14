import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineNuxtConfig({
  ssr: false,
  // Baked in so the bundled server can find app/ and ../library.
  runtimeConfig: { appDir: root },
  compatibilityDate: "2024-11-01",
  devServer: {
    port: 3210,
  },
  modules: ["@nuxt/fonts"],
  fonts: {
    families: [
      {
        name: "Switzer",
        provider: "fontshare",
        weights: [400, 500, 600],
      },
    ],
  },
  app: {
    head: {
      title: "_refs",
      // Set the theme before first paint so a dark page never flashes white.
      script: [
        {
          innerHTML:
            'if(localStorage.getItem("refs-theme")==="dark")document.documentElement.dataset.theme="dark"',
        },
      ],
    },
  },
  css: ["~/assets/main.css"],
  alias: {
    "~~": root,
  },
  nitro: {
    alias: {
      "~~": root,
    },
  },
});
