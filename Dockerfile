FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm i -g bun && bun install --frozen-lockfile
ENV BUILD_TARGET=node
RUN bun run build
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
CMD ["node", "server-entry.mjs"]
