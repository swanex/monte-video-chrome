import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Сайт живёт на собственном поддомене hrom.swanex.com,
// поэтому base = '/' (а не '/имя-репозитория/').
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
});
