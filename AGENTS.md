# Contributor rules

These rules apply to every contributor, human or automated.

## Code

- Do not write code comments. Name things so the code explains itself.
- Do not use emoji in code, docs, commit messages, issues or pull requests.
- Keep functions small and files focused on one job.
- Every tool needs tests that run on generated fixtures.
- Do not add proprietary sample files, keys or parsers for commercial formats. See docs/responsible-use.md.
- Do not add decryption, key search or protection bypass features.

## Commits and pull requests

- Use Conventional Commits, for example `feat(infer): detect offset tables`.
- Author commits as the repository owner: `zzoraemon043 <195147269+zzoraemon043@users.noreply.github.com>`.
- Do not add co-author trailers, tool attribution lines, session links or "generated with" footers.
- Do not mention the tools used to write the code.

## Docs

- Keep `README.md` bilingual: Traditional Chinese (Taiwan) and English.

## Checks before pushing

- `npm test`
- `npm run lint`
- `npm run build`
