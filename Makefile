default: update fmt sync

install:
	./bin/install.zsh

sync:
	npm i --prefix .pi/agent/extensions
	./bin/copy-dotfiles.sh

fmt:
	./bin/format-queries.sh

lint:
	./bin/lint.sh

update:
	pids=""; \
	for script in \
		./bin/update-chrome-cdp-skills.sh \
		./bin/update-database-skills.sh \
		./bin/update-cloudflare-skills.sh \
		./bin/update-mitsuhiko-skills-and-pi-extensions.sh \
		./bin/update-pi-autoresearch-skills-and-extensions.sh \
		./bin/update-modern-go-skills.sh; do \
		$$script & pids="$$pids $$!"; \
	done; \
	status=0; \
	for pid in $$pids; do \
		wait $$pid || status=1; \
	done; \
	exit $$status
