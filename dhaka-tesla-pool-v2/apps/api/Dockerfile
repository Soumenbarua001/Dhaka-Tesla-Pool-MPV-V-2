FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
EXPOSE 4000
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/scripts/seed.js && node dist/src/server.js"]
