// ESLint flat config for the whole repo. Type-aware rules use each package's
// own tsconfig through the TypeScript project service.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'apps/api/drizzle/**',
      '**/*.config.{js,ts}',
      'eslint.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md: never use `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-assertions': [
        'warn',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
      ],
      // Async is often required by an interface (Hono handlers, Result-returning
      // services, test mocks) without an await in the body.
      '@typescript-eslint/require-await': 'off',
      // React event props accept promise-returning handlers; errors surface
      // through TanStack Query / toasts.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests lean on mocks, untyped JSON fixtures and bun's `await expect(..).rejects`
    // (typed as non-thenable): the unsafe-* family adds noise there, not safety.
    files: ['**/*.test.ts', '**/*.test.tsx', 'apps/api/src/test/**'],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts'],
    languageOptions: { globals: { ...globals.node, Bun: 'readonly' } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Design system guard: style form controls and buttons through the
    // primitives in components/ui (see its README), not raw elements.
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use <Select> from components/ui instead of a raw <select>.',
        },
        {
          selector: "JSXOpeningElement[name.name='textarea']",
          message: 'Use <Textarea> from components/ui instead of a raw <textarea>.',
        },
        {
          selector:
            "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value=/^(hidden|file|radio|color)$/]))",
          message:
            'Use <Input> or <Checkbox> from components/ui instead of a raw <input> (hidden, file, radio and color inputs are exempt).',
        },
        {
          selector:
            "JSXAttribute[name.name='className'] :matches(Literal[value=/(^|\\s)(btn|input)(\\s|$)/], TemplateElement[value.raw=/(^|\\s)(btn|input)(\\s|$)/])",
          message:
            'Use <Button> / <Input> from components/ui instead of the .btn / .input classes.',
        },
        {
          selector:
            ':matches(Literal[value=/(^|[\\s:])gray-\\d/], TemplateElement[value.raw=/(^|[\\s:])gray-\\d/])',
          message: 'Use the neutral-* scale (@theme in apps/web/src/index.css), not gray-*.',
        },
      ],
    },
  }
);
