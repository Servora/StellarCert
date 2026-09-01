module.exports = {
  // root: true,
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
  },
  // This project intentionally mixes component exports with context/provider
  // utilities in the same modules, and the React Refresh rule is only an HMR
  // optimization. Keeping it disabled avoids false positives while preserving
  // the rest of the React linting rules.
  ignorePatterns: ["dist", "node_modules"],
};
