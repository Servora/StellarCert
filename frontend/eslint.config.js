// ESLint 9 flat config.
//
// This replaces the deprecated `.eslintrc.cjs` (ESLint 8 + eslintrc format).
// ESLint 8 reached end-of-life, which made current plugin majors
// (`eslint-plugin-react-refresh@0.5.x`, `typescript-eslint@8`,
// `eslint-plugin-react-hooks@5`) impossible to install. Flat config is the
// only supported configuration format on ESLint 9+.
//
// Migration reference:
//   https://eslint.org/docs/latest/use/configure/migration-guide
//
// Parity note: the rule set below intentionally mirrors the previous
// `eslint:recommended` + `plugin:react/recommended` +
// `plugin:react-hooks/recommended` + `plugin:@typescript-eslint/recommended`
// stack so this change is a tooling migration, not a lint-rule change.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'playwright-report',
      'test-results',
      'eslint_out.json',
      'lint-report.json',
    ],
  },
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // TypeScript already performs identifier resolution and unused-symbol
      // analysis, so the base JS rules would only produce false positives.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // This project intentionally mixes component exports with
      // context/provider utilities in the same modules, and the React Refresh
      // rule is only an HMR optimization. Keeping it disabled avoids false
      // positives while preserving the rest of the React linting rules. The
      // plugin is registered above so projects can opt back in per-directory.
      'react-refresh/only-export-components': 'off',
    },
  },
);
