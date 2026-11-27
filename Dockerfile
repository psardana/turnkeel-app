# syntax=docker/dockerfile:1

# The Turnkeel server as one image. It serves the web app, the API and everything
# else from one port.
#
# What runs in it is what the published packages hold: the build stage packs
# @turnkeel/server and the three packages it depends on, exactly as `pnpm pack` does
# for a release, and lays them over a folder that has the server's dependencies at
# the versions of pnpm-lock.yaml.
#
#   docker build --tag turnkeel .
#
# The image needs TURNKEEL_PUBLIC_URL and TURNKEEL_AUTH_SECRET, and DATABASE_URL for
# Postgres. Without TURNKEEL_PUBLIC_URL the server would be in
# local mode, which listens on the loopback address only, and it says so and stops.

ARG NODE_VERSION=22.23.4

# --- build -------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build

# Corepack reads the pnpm version from "packageManager" in package.json.
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# The dependencies first, by the lockfile alone, so that this layer is built again
# only when the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build

# /out: the server with its production dependencies, then each package as packed.
# `pnpm deploy` copies a workspace package with the manifest it has in the
# repository, whose "exports" name the sources; the packed manifest names dist/.
RUN pnpm --filter @turnkeel/server --prod deploy /out \
 && mkdir /tarballs \
 && for dir in apps/server packages/protocol packages/mcp packages/connector-sdk; do \
      pnpm --dir "$dir" pack --silent --pack-destination /tarballs || exit 1; \
    done \
 && tar --extract --gzip --file /tarballs/turnkeel-server-*.tgz --strip-components=1 --directory /out \
 && for name in protocol mcp connector-sdk; do \
      tar --extract --gzip --file /tarballs/turnkeel-"$name"-*.tgz --strip-components=1 \
        --directory "/out/node_modules/@turnkeel/$name/" || exit 1; \
    done \
 && rm /out/pnpm-lock.yaml /out/pnpm-workspace.yaml

# --- app ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS app

ENV NODE_ENV=production \
    TURNKEEL_HOST=0.0.0.0 \
    TURNKEEL_PORT=4400 \
    TURNKEEL_DATA_DIR=/data

WORKDIR /app
# Owned by root and only read by the user the server runs as.
COPY --from=build /out/ ./
# Files are kept under the data folder when no object store is configured.
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 4400

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["node", "--eval", "fetch('http://127.0.0.1:' + (process.env.TURNKEEL_PORT || 4400) + '/healthz').then((answer) => process.exit(answer.ok ? 0 : 1), () => process.exit(1))"]

# Node is process 1 and the server stops on SIGTERM, which is what `docker stop` sends.
CMD ["node", "dist/index.js"]
