#!/usr/bin/env zsh

sqlfmt --no-jinjafmt .psql/queries/*

for file in .psql/queries/*; do
    if [[ -f "$file" ]]; then
        # Fix the e' -> e ' issue
        sed -i.bak "s/ e *'/ e'/g" "$file"
        rm "$file.bak"
    fi
done