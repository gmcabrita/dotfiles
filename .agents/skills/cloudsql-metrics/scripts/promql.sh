#!/usr/bin/env bash
# Run a PromQL query against Cloud Monitoring for a GCP project.
#
#   promql.sh PROJECT QUERY                    instant query
#   promql.sh PROJECT QUERY START END STEP     range query (RFC3339 or unix ts, step like 60s)
#
# Prints the raw Prometheus-style JSON response.
# Exit codes: 1 API/PromQL error, 2 usage, 3 gcloud has no valid credentials.
set -euo pipefail

if [[ $# -ne 2 && $# -ne 5 ]]; then
  sed -n '2,8p' "$0" >&2
  exit 2
fi

project=$1
query=$2
base="https://monitoring.googleapis.com/v1/projects/${project}/location/global/prometheus/api/v1"
if ! token=$(gcloud auth print-access-token 2>/dev/null); then
  echo "gcloud has no valid credentials. The user must run 'gcloud auth login' in their own terminal." >&2
  exit 3
fi

args=(--data-urlencode "query=${query}")
endpoint="${base}/query"
if [[ $# -eq 5 ]]; then
  endpoint="${base}/query_range"
  args+=(--data-urlencode "start=$3" --data-urlencode "end=$4" --data-urlencode "step=$5")
fi

response=$(curl -sS "$endpoint" -H "Authorization: Bearer ${token}" "${args[@]}")
printf '%s\n' "$response"

if [[ $(jq -r '.status // "error"' <<<"$response") != "success" ]]; then
  exit 1
fi
