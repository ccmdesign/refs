// core/ resolves the library and the CLI relative to app/. In the bundled server
// its own location is somewhere under .nuxt or .output, so point it at the real one.
export default defineNitroPlugin(() => {
  process.env.REFS_APP_DIR ||= useRuntimeConfig().appDir;
});
