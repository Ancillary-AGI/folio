import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.next/**', '.kilo/**', '**/.kilo/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      /* A leading underscore is how this codebase says "unused on purpose" —
    * `(_page: NextRequest)`, `(_entry)`, `(_event)`. The recommended preset
    * reports those, so the convention that is already everywhere does not
    * actually work and every new handler has to invent a way around it. */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // App Router pages export `metadata` next to the component — that is the
    // framework's contract, not a Fast Refresh violation.
    files: ['app/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  }
);
