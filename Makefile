#!make

ifneq (,$(wildcard ./.env))
	include .env
	export
endif

.PHONY: help
.DEFAULT_GOAL := help
help:
	@printf "\033[33mUsage:\033[0m\n  make [target] [arg=\"val\"...]\n\n\033[33mTargets:\033[0m\n"
	@awk 'BEGIN { FS = ":.*##"; } /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

ncu: ## Check latest versions of all project dependencies
	@npx npm-check-updates

ncu-upgrade: ## Upgrade all project dependencies to the latest versions
	@npx npm-check-updates -u

.PHONY: install lint typecheck test coverage build package check release

install: ## Install dependencies from the frozen Yarn lockfile
	yarn install --frozen-lockfile

lint: ## Run Biome checks
	yarn lint

typecheck: ## Typecheck without emitting files
	yarn typecheck

test: ## Run the Vitest suite
	yarn test

coverage: ## Run tests with enforced coverage thresholds
	yarn test:coverage

build: ## Typecheck and build the driver
	yarn build

package: ## Build and audit the npm tarball
	yarn package

check: lint typecheck test build ## Run all local quality gates
	yarn test:scripts
	yarn changelog:check
	yarn package:check

VERSION ?=
CHANNEL ?= latest
WATCH ?= 0

release: ## Dispatch release.yml: make release VERSION=2.0.0 CHANNEL=latest WATCH=1
	@test -n "$(VERSION)" || (echo "VERSION is required" && exit 1)
	@test "$(CHANNEL)" = "latest" -o "$(CHANNEL)" = "next" || (echo "CHANNEL must be latest or next" && exit 1)
	gh workflow run release.yml -f release_version=$(VERSION) -f channel=$(CHANNEL)
	@if [ "$(WATCH)" = "1" ]; then sleep 3; gh run watch "$$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status; fi
