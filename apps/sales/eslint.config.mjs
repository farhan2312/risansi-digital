import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not part of the Next app: `.claude/` is harness/tooling (and embeds a
    // whole separate project under impeccable-main), `design/` is scratch
    // prototypes. Linting them only drowned the real app signal in noise.
    ".claude/**",
    "design/**",
  ]),
]);

export default eslintConfig;
