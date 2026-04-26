import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "server/index": "src/server/index.ts",
    "client/index": "src/client/index.ts",
    "validator/index": "src/validator/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["pg", "react", "react-dom"],
  target: "es2022",
});
