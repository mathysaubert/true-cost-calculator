/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],

  // ── Gate de build (vercel-build) : eslint échoue le build sur les ERREURS, pas sur les warnings. ──
  // Politique : bloquant = vraies erreurs (no-undef, imports/variables inutilisés, syntaxe) ; toléré =
  // stylistique (prop-types, apostrophes) rétrogradé en WARNING. Objectif : attraper au build un import
  // manquant / une référence à une variable supprimée (qui traversent la suite de tests, laquelle ne
  // couvre que les fonctions pures, pas le JSX) — SANS échouer sur ~279 erreurs stylistiques préexistantes.
  rules: {
    // Un IMPORT ou une variable locale inutilisés RESTENT bloquants (= symbole supprimé/oublié, le bug
    // qu'on veut attraper). Les paramètres de fonction inutilisés (args) sont tolérés (bénins, courants).
    "no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }],
    // catch {} vide = pattern volontaire (localStorage best-effort) ; tout AUTRE bloc vide reste bloquant.
    "no-empty": ["error", { allowEmptyCatch: true }],
  },

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
        // Stylistiques → WARNINGS non bloquants : props non validées et apostrophes FR non échappées
        // ne sont pas des bugs. Le gate ne rougit que sur les vraies erreurs (no-undef, etc.).
        "react/prop-types": "warn",
        "react/no-unescaped-entities": "warn",
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
      ],
      env: {
        node: true,
      },
    },
  ],
  globals: {
    shopify: "readonly",
    process: "readonly",
  },
};
