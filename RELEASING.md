# Release Suno for Mastra

Releases use the existing Ace Data Cloud Dev GitHub identity. No account-role changes are required for GitHub release publication. npm requires an independently verified publisher for the `@acedatacloud` scope; a configured username alone is not proof of write access.

1. Start a new branch from current remote main after a prior PR is merged. Check instructions, review threads, exact head and green package CI; preserve branch protection.
2. For a version change, update package.json, package-lock.json and the MCP client version together, plus the versioned README installation URLs. Merge the reviewed release change through a normal PR.
3. From the exact merged tree, run `npm ci`, `npm run check`, `npm run pack:check`, then `npm pack`. Inspect the tarball and import the exported provider from a clean consumer. Do not run paid model/media generation.
4. Create the matching `v<version>` tag and GitHub release targeting that exact main commit. Upload the tgz and `SHA256SUMS.txt`. Download the public asset, verify SHA256 and install the downloaded file in a fresh consumer project.
5. If an authorized npm publisher is available, publish the same tgz with public access to registry.npmjs.org, then read back its version/integrity and verify ordinary installation. Do not create wider account permissions to bypass a block or retain a broad personal token in CI. An explicitly authorized one-time publisher may use a temporary encrypted repository secret on trusted main, validate the existing identity, publish only hash-verified allowlisted artifacts with lifecycle scripts disabled, and delete the secret immediately after the run.
6. Record GitHub package release, npm publication, official directory admission, Studio host validation and billing as separate stages. Mastra issue #27373 is closed for now; do not resubmit or nudge without a policy change/invitation.

The current normal CI only runs package checks; merge does not deploy a production service or publish npm automatically. The provider connects to existing MCP endpoints. Remove its registration/package to roll back a consumer integration; do not silently replace a previously published artifact.
