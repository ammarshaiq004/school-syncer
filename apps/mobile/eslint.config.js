// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // eslint-plugin-react's "detect" setting calls context.getFilename(),
    // which ESLint 10 removed. Pin the version (keep it in step with
    // package.json) until the plugin supports ESLint 10.
    settings: { react: { version: '19.3' } },
  },
  {
    ignores: ['dist/*', '.expo/*'],
  },
]);
