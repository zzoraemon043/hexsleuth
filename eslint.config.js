import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const forbidComments = {
  meta: { type: "suggestion", schema: [] },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") {
            continue;
          }
          context.report({ loc: comment.loc, message: "Code comments are not allowed. Use clear names instead." });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "fixtures/**", ".work/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    plugins: { hexsleuth: { rules: { "no-comments": forbidComments } } },
    rules: {
      "hexsleuth/no-comments": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
