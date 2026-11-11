import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ankursingh.design",
  output: "static",
  build: { inlineStylesheets: "auto" },
  devToolbar: { enabled: false },
});
