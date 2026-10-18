# Showcases

Each showcase is a step-by-step session on generated fixtures, written the way an agent would work through it with the hexsleuth tools. Every output shown here was produced by the commands in the text; long outputs are cut down and marked as excerpts.

| Showcase | Format | What it shows |
| --- | --- | --- |
| [png.md](png.md) | PNG | record chains, a zlib stream split across chunks, fixing a draft layout from its first failing field |
| [zip.md](zip.md) | ZIP | fields anchored at the end of the file, offset tables, raw deflate at a known offset |
| [wav.md](wav.md) | WAV | file-size lengths, padded RIFF chunks, a failure that only one sample exposes |
| [hxsf.md](hxsf.md) | HXSF, made up for this repository | counts, offset tables, a string pool, zlib sections and a region reported as possibly-encrypted |

## Setup

```sh
npm ci
npm run build
npm run fixtures
alias hexsleuth="node dist/cli/main.js"
```

The CLI takes the same JSON input as the MCP tool of the same name and prints the same JSON output, so every step can be replayed through the MCP server. The draft layouts used in the sessions are in [layouts/](layouts/); the final layouts are in [examples/layouts/](../../examples/layouts/).
