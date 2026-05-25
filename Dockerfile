# ── Stage 1: Build ────────────────────────────────────────────
# node:20 is based on buildpack-deps and includes python3, make, g++
# so better-sqlite3 compiles without any extra apt installs.
FROM node:20 AS builder

WORKDIR /app

# Backend deps — compiled here so the native .node binary is correct
COPY package*.json ./
RUN npm install

# Frontend deps + build
COPY client/package*.json ./client/
RUN npm install --prefix client

COPY . .
RUN npm run build --prefix client

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Copy compiled backend (includes better-sqlite3 .node binary)
COPY --from=builder /app/node_modules    ./node_modules

# Copy built frontend
COPY --from=builder /app/client/dist     ./client/dist

# Copy source
COPY server.js db.js package.json        ./
COPY scripts                             ./scripts

# Bake in seed/default data — copied into the volume on first run
COPY data                                ./data-defaults

COPY docker-entrypoint.sh               ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001

ENV NODE_ENV=production
ENV DATA_DIR=/data

VOLUME ["/data"]

ENTRYPOINT ["./docker-entrypoint.sh"]
