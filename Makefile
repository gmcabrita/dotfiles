default: update fmt sync

install:
	./bin/install.zsh

sync:
	./bin/copy-dotfiles.sh

fmt:
	./bin/format-queries.sh

lint:
	./bin/lint.sh

update:
	pids=""; \
	for script in \
		./bin/update-amp-contrib-skills.sh \
		./bin/update-database-skills.sh \
		./bin/update-cloudflare-skills.sh \
		./bin/update-mitsuhiko-skills.sh \
		./bin/update-modern-go-skills.sh; do \
		$$script & pids="$$pids $$!"; \
	done; \
	status=0; \
	for pid in $$pids; do \
		wait $$pid || status=1; \
	done; \
	exit $$status
