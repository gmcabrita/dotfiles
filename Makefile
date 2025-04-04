default: fmt sync

install:
	./bin/install.zsh

sync:
	./bin/copy-dotfiles.zsh

fmt:
	./bin/format-queries.zsh