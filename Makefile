.PHONY: clean build stop rebuild

clean:
	rm -f data/*.db data/*.db-shm data/*.db-wal

build:
	podman compose up --build

stop:
	podman compose down

rebuild: stop build
