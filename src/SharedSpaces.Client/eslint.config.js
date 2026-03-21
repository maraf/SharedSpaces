import js from '@eslint/js';
import lit from 'eslint-plugin-lit';
import tseslint from 'typescript-eslint';

const browserGlobals = {
  console: 'readonly',
  CustomEvent: 'readonly',
  customElements: 'readonly',
  document: 'readonly',
  Event: 'readonly',
  HTMLElement: 'readonly',
  HTMLMetaElement: 'readonly',
  window: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['dist', 'dev-dist', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: browserGlobals,
    },
    plugins: {
      lit,
    },
    rules: {
      ...lit.configs['flat/recommended'].rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
