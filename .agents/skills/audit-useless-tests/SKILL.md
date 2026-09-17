---
name: audit-useless-tests
description: Find and prune tests that are low value, duplicative, or assert implementation rather than behavior. Simplify production code after pruning.
disable-model-invocation: true
source: "https://x.com/_lopopolo/status/2086269569841377295"
---

Do a sweep for tests that do nothing than re-assert the source, are low value, duplicative, etc. Remove them and then see whether the production code can be simplified now that the tests no longer demand seams to exist.

Tests must justify their presence. Tests that require changes whenever the underlying source changes are not good tests since they assert implementation, not behavior.
