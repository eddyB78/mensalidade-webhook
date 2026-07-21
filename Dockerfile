FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY index.js interpretador.js ./

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "index.js"]
