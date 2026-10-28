FROM node:18-bookworm-slim

ENV NODE_ENV=production \
    PORT=7860 \
    HOST=0.0.0.0 \
    CAMOUFOX_EXECUTABLE_PATH=/app/camoufox-linux/camoufox

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tar xvfb fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# By default, resolve the browser bundle from the latest project release.
# Override CAMOUFOX_URL only when a different bundle is required.
ARG CAMOUFOX_RELEASE_REPOSITORY=ellinalopez/cloud-studio
ARG CAMOUFOX_URL=

RUN set -eux; \
    if [ -z "${CAMOUFOX_URL}" ]; then \
      CAMOUFOX_URL="$(curl --fail --location --retry 3 \
        "https://api.github.com/repos/${CAMOUFOX_RELEASE_REPOSITORY}/releases/latest" \
        | sed -n 's/.*"browser_download_url": *"\([^"]*camoufox-linux\.tar\.gz\)".*/\1/p' \
        | head -n 1)"; \
    fi; \
    test -n "${CAMOUFOX_URL}" || \
      (echo "No camoufox-linux.tar.gz asset found. Set CAMOUFOX_URL as a build variable." >&2; exit 1); \
    curl --fail --location --retry 3 \
      "${CAMOUFOX_URL}" -o /tmp/camoufox-linux.tar.gz; \
    tar -xzf /tmp/camoufox-linux.tar.gz -C /app; \
    rm -f /tmp/camoufox-linux.tar.gz; \
    test -f /app/camoufox-linux/camoufox; \
    chmod +x /app/camoufox-linux/camoufox

# Copy runtime files from their current repository locations.
COPY dual-runtime/code/unified-server.runtime.js ./unified-server.js
COPY dual-runtime/code/observe-client-scripts.js ./observe-client-scripts.js
COPY dual-runtime/code/stability.js ./stability.js
COPY dual-runtime/code/import-ui.js ./import-ui.js
COPY dual-runtime/code/import-ui.html ./import-ui.html
COPY dual-runtime/code/models.json ./models.json

COPY dual-runtime/refactor/black-browser.js ./black-browser.js
COPY dual-runtime/refactor/verified-client-route.js ./verified-client-route.js

RUN mkdir -p /app/auth \
    && chown -R node:node /app

USER node

EXPOSE 7860 9998
VOLUME ["/app/auth"]

CMD ["node", "unified-server.js"]
