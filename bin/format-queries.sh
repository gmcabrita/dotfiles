#!/usr/bin/env bash

sqlfluff format --dialect postgres ".psql/queries/"*
