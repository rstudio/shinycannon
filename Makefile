all: pretty lint

lint:
	./node_modules/.bin/eslint lib/*

pretty:
	./node_modules/.bin/prettier --write lib/*
