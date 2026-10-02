.PHONY: all build test check

all: build test

build:
	python3 scripts/build.py

test:
	node tests/test_pwa.js

check:
	python3 scripts/build.py --check
	node tests/test_pwa.js
