import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Regla del proyecto: cero `any`. Ver README.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Los componentes NO hablan con Supabase directo — solo services/. Ver ADR-003.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/services/supabase/client', '@/services/supabase/client'],
          message: 'Los componentes no importan el cliente Supabase. Usá un service en modules/<x>/services/. Ver ADR-003.',
        }],
      }],
    },
  },
  // services/ y features/auth/ SÍ pueden importar el cliente: son la capa de acceso.
  {
    files: ['src/services/**/*.ts', 'src/features/auth/**/*.{ts,tsx}', 'src/modules/**/services/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Config de Node
  {
    files: ['vite.config.ts', 'vitest.aislado.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
)
