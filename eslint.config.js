import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

/**
 * Flat ESLint config.
 *
 * Intentionally NOT type-aware (no `parserOptions.project`): keeps linting fast
 * and decoupled from the exact TypeScript version. `eslint-config-prettier` is
 * last so Prettier owns all formatting and ESLint owns code quality.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "dist",
      "build",
      "client/src/components/ui/**", // generated shadcn/ui primitives
      "*.config.js",
      "*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Server (Node)
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Client (browser + React)
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Project-wide rule tuning
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "off",
      // Allow `declare global { namespace Express { ... } }` module augmentation.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      // Existing @ts-ignore pragmas are intentional; surface as warnings, not errors.
      "@typescript-eslint/ban-ts-comment": "warn",
      // Intentional empty catch blocks (error swallowing) are allowed.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  prettier
);
