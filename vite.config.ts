import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Версия приложения (package.json) + код коммита, из которого собран сайт.
// Показываются в «Установках», чтобы версию на экране можно было найти в GitHub.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
let commit = process.env.GITHUB_SHA || '';
if (!commit) {
  try { commit = execSync('git rev-parse HEAD').toString().trim(); } catch { commit = 'local'; }
}

// Сайт живёт на собственном поддомене hrom.swanex.com,
// поэтому base = '/' (а не '/имя-репозитория/').
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});
