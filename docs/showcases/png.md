# PNG chunks

Goal: recover the chunk structure of PNG from six generated images, then emit a parser.

Samples: `fixtures/png/sample-1.png` to `sample-6.png`, 67 to 411 bytes, with different sizes, color types, optional `tEXt` chunks and one to three `IDAT` chunks.

```sh
PNG='["fixtures/png/sample-1.png","fixtures/png/sample-2.png","fixtures/png/sample-3.png","fixtures/png/sample-4.png","fixtures/png/sample-5.png","fixtures/png/sample-6.png"]'
```

## Step 1: probe one sample

```sh
hexsleuth probe '{"file":"fixtures/png/sample-3.png","maxStrings":6,"maxBlocks":4}'
```

Excerpt:

```json
{
  "size": 411,
  "magic": [{ "offset": 0, "bytes": "89 50 4e 47 0d 0a 1a 0a", "name": "PNG image", "confidence": 0.99 }],
  "strings": [
    { "offset": 12, "length": 4, "text": "IHDR" },
    { "offset": 37, "length": 5, "text": "IDATx" },
    { "offset": 220, "length": 4, "text": "IDAT" }
  ],
  "entropy": {
    "highEntropyRegions": [
      {
        "offset": 41, "length": 180, "classification": "compressed",
        "compression": { "method": "zlib", "offset": 41, "compressedSize": 180, "decompressedSize": 169, "complete": false }
      },
      {
        "offset": 221, "length": 190, "classification": "possibly-encrypted",
        "note": "... It follows an interrupted zlib stream that starts at 41, so it may be the continuation of that stream stored in another chunk."
      }
    ]
  }
}
```

What this tells us:

- The signature is known, but we treat the rest as unknown and check every claim.
- Four-letter tags (`IHDR`, `IDAT`) appear at offsets 12, 37 and 220: candidates for record tags.
- A zlib stream starts at 41, right after `IDATx`, and stops being valid after 180 bytes. The next high-entropy region has no header of its own. The probe does not guess what it is; it reports it as possibly-encrypted and notes that it may be the rest of the interrupted stream.

## Step 2: compare all samples

```sh
hexsleuth compare "{\"files\":$PNG,\"maxRegions\":6}"
```

Excerpt:

```json
{
  "fromStart": { "regions": [
    { "kind": "constant", "offset": 0, "length": 19, "bytes": "89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52" },
    { "kind": "variable", "offset": 19, "length": 1, "values": ["01", "08", "10", "05", "20", "0c"] }
  ] },
  "fromEnd": { "regions": [
    { "kind": "constant", "offset": 0, "length": 12, "bytes": "00 00 00 00 49 45 4e 44 ae 42 60 82" }
  ] },
  "sizeTracking": [{ "offset": 19, "endOffsetFromEnd": 12,
    "check": "length equals file size minus 31 in 6 of 6 samples, with a constant header ending at 19 and a constant trailer of 12 bytes" }]
}
```

Every file starts with the same 19 bytes, which include `00 00 00 0d` and `IHDR`, and ends with the same 12 bytes: `00 00 00 00`, `IEND` and four more bytes. The byte at 19 is the image width (1, 8, 16, 5, 32, 12). Both ends look like the same shape: a 4-byte value, a 4-byte tag, data, then 4 bytes.

## Step 3: infer fields

```sh
hexsleuth infer_fields "{\"files\":$PNG}"
```

Excerpt of `findings`:

```json
[
  {
    "kind": "record-chain",
    "field": { "label": "0x0008", "type": "u4be" },
    "claim": "u4be at 0x0008 starts a chain of length-prefixed records from 0x0008 to the end of the file; each record is value + 12 bytes, with the length field 0 bytes into the record; each record has a printable 4-byte tag at +4",
    "check": "walking from 0x0008 by value + 12 lands exactly on the end of the file in 6 of 6 samples (3 to 5 records)",
    "confidence": 0.95,
    "evidence": [{ "sample": "fixtures/png/sample-1.png", "range": { "offset": 8, "length": 59 }, "value": 3,
                   "detail": "3 records ending exactly at 67: IHDR(13), IDAT(10), IEND(0)" }]
  },
  {
    "kind": "endianness",
    "claim": "multi-byte integers are big-endian",
    "check": "1 of 1 signals agree (weighted 1.00): record-chain u4be at 0x0008",
    "confidence": 0.72,
    "limits": ["based on a single signal"]
  }
]
```

The chain explains the whole file after the signature: a big-endian length, a 4-byte tag, `length` bytes of data and 4 more bytes. The endianness finding has lower confidence because it rests on one signal, and it says so.

## Step 4: first hypothesis

The first draft, [layouts/png-draft.json](layouts/png-draft.json), reads the length, the tag and the data, but forgets the 4 trailing bytes that the chain needs (`value + 12` is 4 + 4 + value + 4).

```sh
hexsleuth verify_layout "{\"files\":$PNG,\"layoutFile\":\"docs/showcases/layouts/png-draft.json\",\"includeTree\":false}"
```

Excerpt:

```json
{
  "samples": [
    { "file": "fixtures/png/sample-1.png", "ok": false,
      "error": { "path": "png.chunks[1].data", "offset": 37, "message": "needs 981375829 bytes but only 30 remain" },
      "readBytes": 37, "unreadBytes": 30, "unread": [{ "offset": 37, "length": 30 }] }
  ],
  "summary": { "samples": 6, "parsed": 0, "failed": 6, "fullyRead": 0 }
}
```

The first chunk parses, then the second chunk reads its length from the 4 bytes that follow the `IHDR` data. Those bytes are not a length: they are the trailing field we left out.

## Step 5: check the trailing field

The PNG specification says the trailing 4 bytes are a CRC-32 over the tag and the data. Adding `crc` as `u4` gives [examples/layouts/png.json](../../examples/layouts/png.json):

```sh
hexsleuth verify_layout "{\"files\":$PNG,\"layoutFile\":\"examples/layouts/png.json\",\"maxArrayItems\":2}"
```

Excerpt:

```json
{ "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 6 } }
```

Every sample parses and every byte is read. The fixture tests also recompute the CRC of each chunk, which confirms the meaning of the field.

## Step 6: look inside IDAT

```sh
hexsleuth detect_compression '{"file":"fixtures/png/sample-3.png","offset":41,"writeOutput":false}'
```

Excerpt:

```json
{
  "verdict": "compressed",
  "detected": [{ "method": "zlib", "offset": 41, "compressedSize": 180, "decompressedSize": 169, "complete": false,
                 "evidence": "zlib header passes the FCHECK test and the first 180 bytes inflate cleanly, then the data stops being a valid continuation; the stream is interrupted or truncated, for example split across chunks" }]
}
```

The verified layout explains this: sample 3 has two `IDAT` chunks, and the zlib stream continues in the second one. The image data is the concatenation of all `IDAT` payloads. That is a fact about PNG semantics, not about the byte layout, so it goes into the specification as a note rather than into the layout.

## Step 7: emit

```sh
hexsleuth emit "{\"files\":$PNG,\"layoutFile\":\"examples/layouts/png.json\",\"outDir\":\"out/png\"}"
npx vitest run --root out/png
```

The emit step verifies the layout again and writes `png.md`, `png.ksy`, `png.ts` and `png.test.ts`. Excerpt of the generated test:

```ts
it("parses ../../fixtures/png/sample-1.png", () => {
  const parsed = parsePng(readSample("../../fixtures/png/sample-1.png"));
  expect(parsed.chunks).toHaveLength(3);
  expect(parsed.chunks?.[0]?.length).toBe(13);
  expect(parsed.chunks?.[0]?.chunk_type).toBe("IHDR");
  expect(parsed.chunks?.[0]?.crc).toBe(981375829);
});
```

The six generated tests pass. The repository test suite also compiles `png.ksy` with the Kaitai Struct compiler and checks that it reads the same values.

## Result and limits

- Verified: signature, chunk length, tag, data and CRC in 6 of 6 samples, with no unread bytes.
- Not covered by the layout: the meaning of each chunk type, for example the `IHDR` fields, and the fact that `IDAT` payloads form one zlib stream.
- The second `IDAT` payload is reported as possibly-encrypted by `probe` when looked at alone. The layout shows it is the continuation of the stream, which is why the report always says what it checked and stops there.
