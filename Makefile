default: fmt sync

install:
	./bin/install.zsh

sync:
	./bin/copy-dotfiles.sh

fmt:
	./bin/format-queries.sh

lint:
	./bin/lint.sh
