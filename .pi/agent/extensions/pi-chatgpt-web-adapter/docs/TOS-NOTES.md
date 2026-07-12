# Terms-of-service notes & posture

This adapter automates **your own** ChatGPT account, on **your own** machine,
for **your own** use. It is the software equivalent of a browser extension that
scripts the page you are already logged into.

## Design constraints that keep it personal-use

- **Single account.** Auth comes from one interactive browser login into one
  ChatGPT account. There is no multi-tenant mode, no credential sharing, no
  shared-service deployment path.
- **Single machine.** The browser profile and JWT cache live under your local
  `~/.cache` and `~/.pi`. The daemon binds to `127.0.0.1` only.
- **Your quota.** Every Pro turn consumes one Pro use from your own plan. The
  adapter does not pool or resell capacity.
- **No scraping of others.** It only sends prompts you type and reads the
  responses ChatGPT returns to you.

## What it does *not* do

- It does not bypass payment — you must have an active ChatGPT plan that
  includes the model.
- It does not circumvent account security — it logs in the normal way and reads
  the same session the browser holds.
- It is not intended to be run as a public API, a bot, or a shared backend.

## Your responsibility

OpenAI's Terms of Use govern your account. Automating access to ChatGPT may be
restricted by those terms. Use this at your own discretion and risk; the authors
provide it for personal interoperability and make no warranty. If OpenAI offers
`gpt-5-6-pro` through an official API you can use directly, prefer that.
