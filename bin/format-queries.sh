#!/usr/bin/env bash

sqlfluff format --dialect postgres --ignore linting ".psql/queries/"*
