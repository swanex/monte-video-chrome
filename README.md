# MONTE VIDEO — Проект Хром

In-house веб-приложение студии MONTE VIDEO: виртуальная расстановка сцены на хромакее (1–5 камер), парсинг метаданных BRAW из Premiere Pro, автосборка промптов и генерация чистых задников (clean plates) через Gemini API.

**Сайт:** https://hrom.swanex.com

## Как это устроено

```
правка кода → git push в main → GitHub Actions собирает (npm run build) → GitHub Pages → hrom.swanex.com
```

Руками ничего собирать и выкладывать не нужно: любой пуш в ветку `main` через 1–2 минуты появляется на сайте. Статус сборки — вкладка **Actions** в репозитории.

## Локальный запуск (по желанию)

Нужен Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # проверочная сборка в папку dist/
```

## Структура

| Путь | Что это |
|---|---|
| `src/App.tsx` | Всё приложение (пока монолит, перенесён из Gemini Canvas) |
| `src/main.tsx`, `src/index.css` | Точка входа и Tailwind |
| `public/CNAME` | Привязка к домену hrom.swanex.com — не удалять |
| `.github/workflows/deploy.yml` | Автосборка и деплой на GitHub Pages |
| `CLAUDE.md` | Контекст проекта для Claude |

## Безопасность

API-ключ Google AI Studio вводится в окне «Сетап» и хранится только в `localStorage` браузера. В код и в репозиторий он не попадает. Сайт публичный, но без своего ключа генерация не работает.
