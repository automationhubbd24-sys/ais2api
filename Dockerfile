FROM node:18-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-6 \
    libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxrandr2 libxss1 libxtst6 xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

ARG CAMOUFOX_URL
RUN test -n "$CAMOUFOX_URL" && \
    curl -fsSL "$CAMOUFOX_URL" -o /tmp/camoufox-linux.tar.gz && \
    tar -xzf /tmp/camoufox-linux.tar.gz && \
    rm /tmp/camoufox-linux.tar.gz && \
    chmod +x /app/camoufox-linux/camoufox

COPY dual-runtime/code/unified-server.runtime.js ./unified-server.js
COPY dual-runtime/code/black-browser.js ./
COPY dual-runtime/code/verified-client-route.js ./
COPY dual-runtime/code/observe-client-scripts.js ./
COPY dual-runtime/code/stability.js ./
COPY dual-runtime/code/import-ui.js ./
COPY dual-runtime/code/import-ui.html ./

RUN mkdir /app/auth && chown -R node:node /app

USER node

ENV HOST=0.0.0.0 \
    PORT=7860 \
    CAMOUFOX_EXECUTABLE_PATH=/app/camoufox-linux/camoufox

EXPOSE 7860

CMD ["node", "unified-server.js"]
