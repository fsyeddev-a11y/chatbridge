FROM node:22.13-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@10.15.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .node-version ./
COPY release/app/package.json release/app/package.json
COPY patches patches

RUN pnpm install --frozen-lockfile --ignore-scripts --filter .

COPY . .

RUN pnpm run build:web

FROM nginx:1.27-alpine

COPY railway.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/release/app/dist/renderer /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
