COMPOSE ?= docker compose

.PHONY: help up down stop start restart logs ps clean migrate reset

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

up: ## Start Postgres + Redis (create + run), wait for healthy
	$(COMPOSE) up -d --wait

down: ## Stop and remove containers (keep volumes/data)
	$(COMPOSE) down

stop: ## Stop containers without removing them
	$(COMPOSE) stop

start: ## Start previously created containers
	$(COMPOSE) start

restart: ## Restart containers
	$(COMPOSE) restart

logs: ## Tail container logs
	$(COMPOSE) logs -f

ps: ## Show container status
	$(COMPOSE) ps

clean: ## Stop and remove containers AND volumes (destroys data)
	$(COMPOSE) down -v

migrate: ## Run pending DB migrations
	pnpm migrate:up

reset: clean up migrate ## Wipe data, restart infra, re-run migrations
