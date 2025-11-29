FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_HOST=http://localhost:4002
ENV NEXT_PUBLIC_API_HOST=${NEXT_PUBLIC_API_HOST}
ENV HOST=0.0.0.0

COPY web/package*.json ./
RUN npm ci

COPY web ./
COPY packages ./packages

RUN npm run build

FROM node:20-alpine

WORKDIR /app

ARG NEXT_PUBLIC_API_HOST=http://localhost:4002
ENV NEXT_PUBLIC_API_HOST=${NEXT_PUBLIC_API_HOST}
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package*.json ./

EXPOSE 3000

CMD ["npm", "start"]
