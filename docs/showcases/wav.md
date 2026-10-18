# WAV RIFF chunks

Goal: recover the RIFF chunk structure from six generated WAV files with different channel counts, sample rates and lengths. Some files carry a `LIST` chunk, and two carry a `JUNK` chunk.

```sh
WAV='["fixtures/wav/sample-1.wav","fixtures/wav/sample-2.wav","fixtures/wav/sample-3.wav","fixtures/wav/sample-4.wav","fixtures/wav/sample-5.wav","fixtures/wav/sample-6.wav"]'
```

## Step 1: probe one sample

```sh
hexsleuth probe '{"file":"fixtures/wav/sample-3.wav","maxStrings":8,"maxBlocks":3}'
```

Excerpt:

```json
{
  "magic": [
    { "offset": 0, "bytes": "52 49 46 46", "name": "RIFF container", "confidence": 0.8 },
    { "offset": 8, "bytes": "57 41 56 45", "name": "WAVE audio in RIFF", "confidence": 0.95 }
  ],
  "strings": [
    { "offset": 0, "length": 5, "text": "RIFF2" },
    { "offset": 8, "length": 8, "text": "WAVEfmt " },
    { "offset": 36, "length": 4, "text": "JUNK" },
    { "offset": 48, "length": 4, "text": "data" }
  ],
  "entropy": { "highEntropyRegions": [] },
  "alignment": {
    "sizeAlignment": 2,
    "paddingRuns": [
      { "offset": 41, "length": 7, "byte": 0, "endAlignment": 16 },
      { "offset": 54, "length": 4, "byte": 0, "endAlignment": 2 }
    ]
  }
}
```

Four-letter tags at 12, 36 and 48. Nothing has high entropy: PCM audio is not compressed.

## Step 2: compare

```sh
hexsleuth compare "{\"files\":$WAV,\"maxRegions\":8}"
```

Excerpt of `fromStart`:

```json
[
  { "kind": "constant", "offset": 0, "length": 4, "bytes": "52 49 46 46" },
  { "kind": "variable", "offset": 4, "length": 2, "values": ["a4 00", "ce 01", "32 02", "c4 00", "0c 04", "7c 00"] },
  { "kind": "constant", "offset": 6, "length": 16, "bytes": "00 00 57 41 56 45 66 6d 74 20 10 00 00 00 01 00" },
  { "kind": "variable", "offset": 22, "length": 1, "values": ["01", "02", "01", "02", "01", "02"] }
]
```

Bytes 4 and 5 grow with the file: 0xa4 is 164 for a 172-byte file. Offset 22 alternates between 1 and 2, which matches mono and stereo samples.

## Step 3: infer fields

```sh
hexsleuth infer_fields "{\"files\":$WAV}"
```

Excerpt of `findings`:

```json
[
  { "kind": "length", "field": { "label": "0x0004", "type": "u4le" }, "confidence": 0.95,
    "claim": "u4le at 0x0004 holds the length of the rest of the file after the field (file size minus 8)",
    "check": "value equals file size minus 8 in 6 of 6 samples (6 distinct sizes)",
    "evidence": [{ "sample": "fixtures/wav/sample-1.wav", "range": { "offset": 4, "length": 4 }, "value": 164,
                   "detail": "file size 172 - 8 = 164 at 0x0004" }] },
  { "kind": "record-chain", "field": { "label": "0x0010", "type": "u4le" }, "confidence": 0.95,
    "claim": "u4le at 0x0010 starts a chain of length-prefixed records from 0x000c to the end of the file; each record is value + 8 bytes, padded to an even length, with the length field 4 bytes into the record; each record has a printable 4-byte tag at +0",
    "check": "walking from 0x0010 by value + 8 lands exactly on the end of the file in 6 of 6 samples (2 to 4 records)",
    "evidence": [{ "sample": "fixtures/wav/sample-1.wav", "range": { "offset": 12, "length": 160 }, "value": 2,
                   "detail": "2 records ending exactly at 172: fmt (16), data(128)" }] },
  { "kind": "endianness", "claim": "multi-byte integers are little-endian", "confidence": 0.83 }
]
```

The chain finding contains a detail that is easy to miss: "padded to an even length". The walk only lands on the end of every file if odd lengths are rounded up.

## Step 4: first hypothesis without padding

The draft [layouts/wav-draft.json](layouts/wav-draft.json) reads a tag, a length and `length` bytes, and ignores the padding.

```sh
hexsleuth verify_layout "{\"files\":$WAV,\"layoutFile\":\"docs/showcases/layouts/wav-draft.json\",\"includeTree\":false}"
```

Excerpt:

```json
{
  "samples": [
    { "file": "fixtures/wav/sample-1.wav", "ok": true, "unreadBytes": 0 },
    { "file": "fixtures/wav/sample-3.wav", "ok": false,
      "error": { "path": "wav.chunks[2].body", "offset": 55, "message": "needs 131681 bytes but only 515 remain" },
      "unread": [{ "offset": 55, "length": 515 }] }
  ],
  "summary": { "samples": 6, "parsed": 5, "failed": 1, "fullyRead": 5 }
}
```

Five samples parse. Only sample 3 fails, and only after its `JUNK` chunk. A look at the bytes shows why:

```sh
hexsleuth read_bytes '{"file":"fixtures/wav/sample-3.wav","offset":36,"length":20,"interpret":["u4le"]}'
```

```json
{ "rows": [
  { "offset": 36, "hex": "4a 55 4e 4b 03 00 00 00 00 00 00 00 64 61 74 61", "ascii": "JUNK........data" },
  { "offset": 52, "hex": "02 02 00 00", "ascii": "...." }
] }
```

`JUNK` declares 3 bytes, but `data` starts 4 bytes after the end of the length field. The extra zero is the pad byte. This is the kind of mistake that passes on most samples, which is why every sample is verified.

## Step 5: add the pad and decode the format chunk

The final layout [examples/layouts/wav.json](../../examples/layouts/wav.json) adds `pad` with size `length % 2` and reads the `fmt ` chunk body as a structure when `chunk_id == "fmt "`.

```sh
hexsleuth verify_layout "{\"files\":$WAV,\"layoutFile\":\"examples/layouts/wav.json\",\"maxArrayItems\":4}"
```

Excerpt:

```json
{ "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 6 } }
```

The tree now shows `channels` 1 or 2 at offset 22 and `sample_rate` at 24, which matches the variable regions found by `compare`.

## Step 6: emit

```sh
hexsleuth emit "{\"files\":$WAV,\"layoutFile\":\"examples/layouts/wav.json\",\"outDir\":\"out/wav\"}"
npx vitest run --root out/wav
```

The generated parser handles the conditional `format` and `body` fields and the computed padding; its six tests pass.

## Result and limits

- Verified: RIFF header, chunk chain with padding and the PCM format chunk in 6 of 6 samples, with no unread bytes.
- Not covered: the contents of `LIST` and `JUNK`, and formats other than 16-bit PCM. The samples only contain format 1.
