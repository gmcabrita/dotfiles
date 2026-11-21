#!/usr/bin/env bash

set -euo pipefail

sqlfluff format --dialect postgres --ignore linting ".psql/queries/"*
./bin/sync-queries
