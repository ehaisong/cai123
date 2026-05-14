FROM hub.rat.dev/library/node:20-alpine
WORKDIR /app
COPY . .
# 设置 npm 淘宝镜像
RUN npm config set registry https://registry.npmmirror.com
# 安装 bun（仅用于 build）
RUN npm i -g bun
# 用 npm install 替代 bun install（淘宝镜像完整支持，无二进制挂起）
RUN npm install --prefer-offline 2>&1 | tail -5
ENV BUILD_TARGET=node
RUN bun run build
EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
CMD ["node", "server-entry.mjs"]
