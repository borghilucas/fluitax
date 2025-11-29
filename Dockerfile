FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY packages ./packages

RUN npm ci
RUN npx prisma generate

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4002

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY packages ./packages

EXPOSE 4002

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
