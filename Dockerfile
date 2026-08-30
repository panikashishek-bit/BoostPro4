# Образ приложения «ПроСервис» (Next.js).
# На сервере нет Node — всё собирается внутри контейнера.

FROM node:24-alpine AS build
WORKDIR /app

# Зависимости отдельным слоем: пока package-lock.json не менялся, слой берётся из кэша.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# У бокса 2 ГБ памяти — сборке Next нужен потолок, иначе она уходит в OOM.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
# Схема накатывается при каждом старте: db push идемпотентен, а база может быть новой.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
