# Образ бота-администратора.
# Контекст сборки — корень проекта: боту нужна ещё база знаний из ../faq/.

FROM node:24-alpine
WORKDIR /srv/bot_administrator

COPY bot_administrator/package.json bot_administrator/package-lock.json ./
# tsx лежит в devDependencies, а бот запускается через него — ставим всё.
RUN npm ci

COPY bot_administrator/tsconfig.json ./
COPY bot_administrator/src ./src
COPY bot_administrator/role.md bot_administrator/character.md ./

# Путь важен: knowledge.ts ищет базу знаний на уровень выше папки бота.
COPY faq /srv/faq

# Переменные окружения приходят из compose, поэтому --env-file не нужен.
CMD ["npx", "tsx", "src/bot.ts"]
