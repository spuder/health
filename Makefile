.PHONY: default dev \
	build-podman stop-podman \
	build-container stop-container \
	publish

default: dev

dev:
	npm install
	npm install --prefix client
	trap 'kill 0' EXIT; [ -f .envrc ] && . .envrc; node server.js & cd client && npx vite

clean:
	rm -f data/*.db data/*.db-shm data/*.db-wal

# ── Podman ────────────────────────────────────────────────────
build-podman:
	podman compose up --build

stop-podman:
	podman compose down

# ── Apple Container ───────────────────────────────────────────
build-container:
	container system start
	container system status
	container build -t health .
	container rm -f health 2>/dev/null; true
	container run -d \
		--name health \
		-p 3001:3001 \
		-v "$(PWD)/data:/data" \
		-e NODE_ENV=production \
		-e DATA_DIR=/data \
		--env-file .env \
		health

stop-container:
	container rm -f health 2>/dev/null; true

# ── Remote deploy ─────────────────────────────────────────────
publish:
	curl -X POST https://dockhand.snowy-vibes.ts.net/api/git/stacks/4/webhook \
		-H "Content-Type: application/json" \
		-H "X-Webhook-Secret: $(DOCKHAND_WEBHOOK_SECRET)"
