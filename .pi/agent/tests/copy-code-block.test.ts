import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCodeBlocks } from "../extensions/copy-code-block.ts";

test("extracts multiple fenced blocks in order", () => {
	const markdown = [
		"Intro",
		"```ts",
		"const a = 1;",
		"```",
		"Middle",
		"~~~",
		"echo hi",
		"~~~",
	].join("\n");
	assert.deepEqual(extractCodeBlocks(markdown), [
		{ language: "ts", code: "const a = 1;" },
		{ language: "", code: "echo hi" },
	]);
});

test("keeps nested shorter fences inside a longer fence", () => {
	const markdown = ["````md", "```js", "x", "```", "````"].join("\n");
	assert.deepEqual(extractCodeBlocks(markdown), [{ language: "md", code: "```js\nx\n```" }]);
});

test("keeps an unclosed block", () => {
	assert.deepEqual(extractCodeBlocks("```sh\nls\n"), [{ language: "sh", code: "ls" }]);
});

test("ignores inline backticks", () => {
	assert.deepEqual(extractCodeBlocks("use `foo` here"), []);
});
