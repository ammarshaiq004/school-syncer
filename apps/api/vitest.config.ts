import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      // Measured over every service and rule file, not only the ones a test
      // happens to import, so new untested logic lowers the number.
      // Controllers and modules are wiring, covered by the e2e suites.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.controller.ts', 'src/**/*.module.ts', 'src/main.ts'],
      reporter: ['text-summary', 'html'],
      // Just below the measured level (51.1 / 49.0 / 50.6 / 50.5 when added)
      // so coverage can't silently drop. Raise these as tests are added.
      thresholds: { statements: 50, branches: 48, functions: 50, lines: 50 },
    },
  },
});
