FROM python:3.12-bookworm

ENV NODE_VERSION=22.20.0 \
    FLY_DATA=/data/fly-data \
    FLY_HOST=127.0.0.1 \
    FLY_PORT=8787 \
    BRAIN_ORIGIN=http://127.0.0.1:8787 \
    PORT=3000 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    npm_config_update_notifier=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
         amd64) node_arch=linux-x64 ;; \
         arm64) node_arch=linux-arm64 ;; \
         *) echo "unsupported architecture: $arch" && exit 1 ;; \
       esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${node_arch}.tar.xz" \
         | tar -xJ -C /usr/local --strip-components=1 \
    && apt-get purge -y --auto-remove xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY sim/requirements.txt sim/requirements.txt
RUN pip install --no-cache-dir -r sim/requirements.txt

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && npm prune --omit=dev

EXPOSE 3000
VOLUME ["/data/fly-data"]

CMD ["node", "scripts/start.mjs"]
