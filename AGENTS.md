# SunoMastra

This repository owns the independent Suno integration for Mastra. API tools and schemas come from AceDataCloud/MCPs (`suno/`); do not duplicate the service API client here.

- Work on an isolated checkout and deliver through a PR using Ace Data Cloud Dev.
- Run `npm ci`, `npm run check`, and `npm run pack:check` before submitting changes.
- Tests use loopback MCP servers. Never run paid media generation as a test.
- Do not add automatic tool-call retries, regenerate to poll, or claim official Mastra catalog admission from package publication.
- Keep keys server-side and out of provider metadata, logs, prompts, commits, and exports.
- Keep README.md and readme/README_zh_Hans.md onboarding consistent.
