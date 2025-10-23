#!/usr/bin/env bash

find . -type f ! -path "*/.git/*" -exec sh -c '
   exitcode=0
   for f do
       # Skip binaries quickly
       grep -Iq . -- "$f" || continue

       # Read first line (shebang)
       IFS= read -r first < "$f" || continue

       # Single regex: env or absolute path; shells: sh|bash|zsh|ksh|mksh|yash
       # Portable grep -E, avoid bashisms inside /bin/sh
       printf "%s" "$first" | grep -Eq "^#! *(/usr/bin/env +)?(ba|z|mk|ya)?sh( |$)|^#! */(usr/)?bin/(ba|z|k|mk|ya)?sh( |$)" || continue

       shellcheck -s bash -x "$f" || exitcode=$?
   done
   exit $exitcode
' sh {} +
