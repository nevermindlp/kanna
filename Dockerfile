FROM oven/bun:1.3.5 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Trim to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

FROM oven/bun:1.3.5 AS runtime

WORKDIR /app

# Runtime tools: embedded terminal shell, Git panel, and OpenSpec CLI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
  && rm -rf /var/lib/apt/lists/* \
  && bun install -g --trust @fission-ai/openspec@1.4.1

ENV NODE_ENV=production
# Prevent startup from trying to globally install a newer npm package inside the container.
ENV KANNA_DISABLE_SELF_UPDATE=1
ENV KANNA_DISABLE_UPDATES=1
ENV KANNA_PROJECT_ROOT=/projects
ENV SHELL=/bin/bash
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PATH="/root/.bun/bin:/usr/local/bin:${PATH}"

# Required at runtime: version lookup (cli.ts) and branding imports.
COPY package.json bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
# Includes dist/client (web UI) and dist/export-viewer (standalone transcript export).
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/shared ./src/shared

EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3210/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["bun", "src/server/cli.ts"]
CMD ["--host", "0.0.0.0", "--port", "3210", "--no-open"]
