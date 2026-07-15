default: update fmt sync

install:
	./bin/install.zsh

sync:
	pnpm install --prefix .pi/agent || true
	./bin/copy-dotfiles.sh

fmt:
	./bin/format-queries.sh

lint:
	./bin/lint.sh

update:
	pids=""; \
	for script in \
	  "sfw pnpm update --prefix .pi/agent --latest" \
		./bin/update-chrome-cdp-skills.sh \
		./bin/update-hegel-skills.sh \
		./bin/update-cursor-skills.sh \
		./bin/update-mitsuhiko-skills-and-pi-extensions.sh \
		./bin/update-davis7dotsh-extensions.sh \
		./bin/update-modern-go-skills.sh \
		./bin/update-pi-autoresearch-skills-and-extensions.sh; do \
		$$script & pids="$$pids $$!"; \
	done; \
	status=0; \
	for pid in $$pids; do \
		wait $$pid || status=1; \
	done; \
	./bin/ensure-disabled-skill-model-invocation.sh || status=1; \
	exit $$status
