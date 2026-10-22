import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
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
    plugins: { "unused-imports": unusedImports },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // unused-imports owns unused reporting: it auto-removes dead imports on
      // --fix, and flags unused locals/args (underscore-prefixed are ignored).
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          // Allow `const { drop, ...rest } = obj` field-omit idiom.
          ignoreRestSiblings: true,
          // Don't flag unused catch bindings (`catch (e)`) — idiomatic noise.
          caughtErrors: "none",
        },
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
