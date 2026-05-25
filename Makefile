.PHONY: clean build stop rebuild publish

clean:
	rm -f data/*.db data/*.db-shm data/*.db-wal

build:
	podman compose up --build

stop:
	podman compose down

rebuild: stop build

publish:
	curl -X POST https://dockhand.snowy-vibes.ts.net/api/git/stacks/1/webhook \
		-H "Content-Type: application/json" \
		-H "X-Webhook-Secret: $(DOCKHAND_WEBHOOK_SECRET)"


