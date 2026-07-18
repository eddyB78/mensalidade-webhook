FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY index.js ./

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "index.js"]
