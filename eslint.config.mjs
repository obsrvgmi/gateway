import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Vendored BoardUI date pickers sync props into state in an effect. We keep them as the CLI ships
    // them, so this one rule is off for these two files rather than hand-editing the source.
    files: ["components/base/date-picker/date-picker.tsx", "components/base/date-picker/shared.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    // After signing in or out, a full load is what we want: the session changed, so the store starts fresh.
    rules: { "@next/next/no-location-assign-relative-destination": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent tooling and build output, not application code.
    ".agents/**",
    "dist/**",
    "packages/react/dist/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
