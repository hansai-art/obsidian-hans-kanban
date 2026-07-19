import tsparser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	...obsidianmd.configs.recommended,

	{
		files: ['**/*.ts'],
		plugins: {
			'@typescript-eslint': tseslint,
		},
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: './tsconfig.json',
			},
			globals: {
				console: 'readonly',
				document: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				requestAnimationFrame: 'readonly',
			},
		},
		rules: {
			'@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
			'max-depth': ['warn', 3],
		},
	},

	{
		// The build script runs in Node, never in Obsidian, so the plugin-runtime
		// rules (no-nodejs-modules and friends) do not apply to it.
		files: ['esbuild.config.mjs'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},

	{
		ignores: ['dist/**', 'node_modules/**', 'tests/**'],
	},
]);
