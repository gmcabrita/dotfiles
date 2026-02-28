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
	./bin/update-amp-contrib-skills.sh
	./bin/update-database-skills.sh
	./bin/update-cloudflare-skills.sh
	./bin/update-mitsuhiko-skills.sh
	./bin/update-modern-go-skills.sh
