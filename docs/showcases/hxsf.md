# HXSF: offset table, string pool and compressed sections

HXSF is a format made up for this repository. Its generator is `scripts/fixtures/hxsf.ts`; this session ignores it and works only from six samples, as an agent would with an undocumented format.

```sh
HXSF='["fixtures/hxsf/sample-1.hxsf","fixtures/hxsf/sample-2.hxsf","fixtures/hxsf/sample-3.hxsf","fixtures/hxsf/sample-4.hxsf","fixtures/hxsf/sample-5.hxsf","fixtures/hxsf/sample-6.hxsf"]'
```

## Step 1: probe the largest sample

```sh
hexsleuth probe '{"file":"fixtures/hxsf/sample-4.hxsf","maxStrings":10,"maxBlocks":8}'
```

Excerpt:

```json
{
  "size": 1747,
  "magic": [{ "offset": 0, "bytes": "48 58 53 46", "name": "unknown printable tag \"HXSF\"", "confidence": 0.5 }],
  "strings": [
    { "offset": 0, "length": 4, "text": "HXSF" },
    { "offset": 132, "length": 10, "text": "noise0.bin" },
    { "offset": 143, "length": 13, "text": "notes-3-1.txt" },
    { "offset": 157, "length": 10, "text": "table2.bin" },
    { "offset": 168, "length": 13, "text": "notes-3-3.txt" },
    { "offset": 182, "length": 10, "text": "noise4.bin" }
  ],
  "entropy": {
    "blocks": [
      { "offset": 0, "entropy": 4.971 }, { "offset": 256, "entropy": 7.186 }, { "offset": 512, "entropy": 7.062 },
      { "offset": 768, "entropy": 6.352 }, { "offset": 1024, "entropy": 7.149 }, { "offset": 1280, "entropy": 7.109 },
      { "offset": 1536, "entropy": 7.069 }
    ],
    "highEntropyRegions": [
      { "offset": 256, "length": 253, "classification": "possibly-encrypted" },
      { "offset": 509, "length": 259, "classification": "compressed",
        "compression": { "method": "zlib", "offset": 509, "compressedSize": 305, "decompressedSize": 1052, "complete": true } },
      { "offset": 1024, "length": 227, "classification": "compressed",
        "compression": { "method": "zlib", "offset": 942, "compressedSize": 309, "decompressedSize": 1054, "complete": true } },
      { "offset": 1251, "length": 496, "classification": "possibly-encrypted" }
    ]
  }
}
```

Three things stand out: a block of five null-separated names starting at 132, two complete zlib streams at 509 and 942, and two high-entropy regions that no supported compression explains. Those two are reported as `possibly-encrypted`. hexsleuth will not try to decrypt them, search for keys or guess XOR patterns; the session treats them as opaque from here on.

## Step 2: compare the headers

```sh
hexsleuth compare "{\"files\":$HXSF,\"maxRegions\":14}"
```

Excerpt of `fromStart`:

```json
[
  { "kind": "constant", "offset": 0, "length": 4, "bytes": "48 58 53 46" },
  { "kind": "variable", "offset": 4, "length": 1, "values": ["01", "02", "01", "02", "01", "02"] },
  { "kind": "constant", "offset": 5, "length": 1, "bytes": "00" },
  { "kind": "variable", "offset": 6, "length": 1, "values": ["01", "00", "00", "01", "00", "00"] },
  { "kind": "constant", "offset": 7, "length": 1, "bytes": "00" },
  { "kind": "variable", "offset": 8, "length": 2, "values": ["ca 00", "48 03", "5c 03", "d3 06", "42 04", "48 06"] },
  { "kind": "constant", "offset": 10, "length": 2, "bytes": "00 00" },
  { "kind": "variable", "offset": 12, "length": 1, "values": ["01", "03", "02", "05", "04", "06"] },
  { "kind": "constant", "offset": 13, "length": 7, "bytes": "00 00 00 20 00 00 00" },
  { "kind": "variable", "offset": 20, "length": 1, "values": ["34", "5c", "48", "84", "70", "98"] }
]
```

A 4-byte magic, then what looks like 2-byte and 4-byte little-endian integers: low bytes vary, high bytes stay zero. Offset 8 reads `ca 00` = 202 in a 202-byte file.

## Step 3: infer the header fields

```sh
hexsleuth infer_fields "{\"files\":$HXSF}"
```

Excerpt of `findings`, highest confidence first:

```json
[
  { "kind": "offset", "field": { "label": "0x0014", "type": "u4le" }, "confidence": 0.99,
    "check": "points to printable text in 6 of 6 samples; value equals 32 + 20 x u4le at 0x000c, the end of a table of 20-byte records; value + u4le at 0x0018 equals u4le at 0x001c in 6 of 6 samples" },
  { "kind": "length", "field": { "label": "0x0008", "type": "u4le" }, "confidence": 0.95,
    "claim": "u4le at 0x0008 holds the total file size",
    "check": "value equals file size minus 0 in 6 of 6 samples (6 distinct sizes)" },
  { "kind": "endianness", "claim": "multi-byte integers are little-endian", "confidence": 0.95 },
  { "kind": "count", "field": { "label": "0x000c", "type": "u4le" }, "confidence": 0.9,
    "claim": "u4le at 0x000c counts 20-byte records in a table that starts at u4le at 0x0010 (32) and ends at the offset in u4le at 0x0014",
    "check": "u4le at 0x0014 equals 32 + 20 x value in 6 of 6 samples (6 distinct counts)",
    "evidence": [{ "sample": "fixtures/hxsf/sample-1.hxsf", "range": { "offset": 12, "length": 4 }, "value": 1, "detail": "32 + 20 x 1 = 52" }] },
  { "kind": "offset", "field": { "label": "0x0010", "type": "u4le" }, "confidence": 0.75,
    "check": "value is where a table of u4le at 0x000c x 20-byte records starts; the table ends at the offset in u4le at 0x0014",
    "limits": ["value is the same in every sample, so it may be a constant that happens to fall inside the file"] },
  { "kind": "length", "field": { "label": "0x0018", "type": "u4le" }, "confidence": 0.75,
    "claim": "u4le at 0x0018 holds the size of the region that starts at the offset in u4le at 0x0014" },
  { "kind": "version", "field": { "label": "0x0004", "type": "u2le" }, "confidence": 0.65,
    "check": "small value (1, 2) directly after the magic bytes in 6 of 6 samples",
    "limits": ["only a few distinct values; flags or type codes look the same"] },
  { "kind": "offset", "field": { "label": "0x001c", "type": "u4le" }, "confidence": 0.6,
    "check": "value equals u4le at 0x0014 + u4le at 0x0018 in 6 of 6 samples, so it marks where that region ends" }
]
```

Put together, the header is 32 bytes:

| Offset | Field | Evidence |
| --- | --- | --- |
| 0 | magic `HXSF` | constant in 6 of 6 |
| 4 | version, u2 | 1 or 2, right after the magic; could also be a type code |
| 6 | u2, 0 or 1 | no finding; probably flags |
| 8 | file size, u4 | equals the file size in 6 of 6 |
| 12 | entry count, u4 | table end = 32 + 20 x count in 6 of 6 |
| 16 | table offset, u4 | always 32, where the 20-byte table starts |
| 20 | pool offset, u4 | the table ends here, and the target is text |
| 24 | pool size, u4 | pool offset + pool size = the value at 28 |
| 28 | data offset, u4 | where the pool ends |

The strings at 132 in sample 4 fit: its header holds a pool offset of 0x84 (132).

## Step 4: first hypothesis

The draft [layouts/hxsf-draft.json](layouts/hxsf-draft.json) reads the header, `entry_count` table records with placeholder names, and the pool.

```sh
hexsleuth verify_layout "{\"files\":$HXSF,\"layoutFile\":\"docs/showcases/layouts/hxsf-draft.json\",\"maxArrayItems\":6}"
```

Excerpt:

```json
{
  "samples": [
    { "file": "fixtures/hxsf/sample-1.hxsf", "ok": true, "readBytes": 66, "unreadBytes": 136, "unread": [{ "offset": 66, "length": 136 }] },
    { "file": "fixtures/hxsf/sample-4.hxsf", "ok": true, "readBytes": 193, "unreadBytes": 1554, "unread": [{ "offset": 193, "length": 1554 }] }
  ],
  "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 0 }
}
```

Every sample parses, so the header, table and pool sizes are right. Each sample has exactly one unread range, from `data_offset` to the end of the file: the data area.

## Step 5: work out the table records

The tree of sample 4 shows the five records (field names are placeholders by their offset in the record):

| field_0 | field_4 | field_6 | field_8 | field_12 | field_16 |
| --- | --- | --- | --- | --- | --- |
| 0 | 3 | 0 | 193 | 316 | 316 |
| 11 | 1 | 1 | 509 | 305 | 1052 |
| 25 | 2 | 0 | 814 | 128 | 128 |
| 36 | 1 | 1 | 942 | 309 | 1054 |
| 50 | 3 | 0 | 1251 | 496 | 496 |

Asking `infer_fields` about the first record only, with the header fields still available as evidence:

```sh
hexsleuth infer_fields "{\"files\":$HXSF,\"region\":{\"offset\":32,\"length\":20},\"endScanLength\":0}"
```

Excerpt:

```json
{ "kind": "offset", "field": { "label": "0x0028", "type": "u4le" }, "confidence": 0.6,
  "check": "value equals u4le at 0x0014 + u4le at 0x0018 in 6 of 6 samples, so it marks where that region ends" }
```

So `field_8` of the first record points at the start of the data area. The rest follows from the table and from the other tools:

- `field_8 + field_12` equals the next record's `field_8`: 193 + 316 = 509, 509 + 305 = 814, and the last one ends at 1747, the file size. `field_8` is a data offset and `field_12` a stored size.
- `field_0` matches the string pool: 132 + 11 = 143 is where `notes-3-1.txt` starts. It is a name offset inside the pool.
- `field_6` is 1 exactly for the two records at 509 and 942, where `probe` found zlib streams. `field_16` equals `field_12` when `field_6` is 0.

Check the zlib claim directly:

```sh
hexsleuth detect_compression '{"file":"fixtures/hxsf/sample-4.hxsf","offset":509}'
```

```json
{ "verdict": "compressed", "tried": ["zlib", "deflate-raw"],
  "detected": [{ "method": "zlib", "offset": 509, "compressedSize": 305, "decompressedSize": 1052, "complete": true }] }
```

The stream is exactly `field_12` (305) bytes long and inflates to `field_16` (1052) bytes. So `field_6` is the codec (0 stored, 1 zlib) and `field_16` is the raw size.

And the first record, at 193 with codec 0:

```sh
hexsleuth detect_compression '{"file":"fixtures/hxsf/sample-4.hxsf","offset":193,"length":316,"writeOutput":false}'
```

```json
{ "entropy": 7.361, "tried": ["deflate-raw"], "verdict": "possibly-encrypted", "detected": [],
  "note": "High entropy and no supported compression decodes here. hexsleuth reports this and stops; it does not attempt decryption, key search or XOR guessing." }
```

The record is stored as is and its content cannot be analyzed further. The layout reads it as opaque bytes and the session moves on. `field_4` takes the values 1, 2 and 3, and the names suggest text, tables and noise, but nothing in the bytes proves that, so the field is called `kind` and its meaning stays undocumented.

## Step 6: final layout

[examples/layouts/hxsf.json](../../examples/layouts/hxsf.json) names the record fields and adds three instances to each record: `name` (a null-terminated string at `_root.header.pool_offset + name_offset`), `stored_data` when `codec == 0` and `inflated_data` with `process: zlib` when `codec == 1`.

```sh
hexsleuth verify_layout "{\"files\":$HXSF,\"layoutFile\":\"examples/layouts/hxsf.json\",\"includeTree\":false}"
```

```json
{ "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 6 } }
```

## Step 7: emit

```sh
hexsleuth emit "{\"files\":$HXSF,\"layoutFile\":\"examples/layouts/hxsf.json\",\"outDir\":\"out/hxsf\"}"
npx vitest run --root out/hxsf
```

The specification lists the verification of every sample and maps each high-entropy region to the field that holds it. Excerpt of `out/hxsf/hxsf.md`:

```markdown
| `fixtures/hxsf/sample-4.hxsf` | 0x0100 to 0x01fd | possibly-encrypted | `entries[0].stored_data` |
| `fixtures/hxsf/sample-4.hxsf` | 0x01fd to 0x0300 | compressed (zlib) | `entries[1].inflated_data` |
```

The generated parser inflates the zlib sections with `node:zlib`, and the six generated tests pass.

## Result and limits

- Verified: header, offset table, string pool, stored and zlib sections in 6 of 6 samples, with no unread bytes.
- Field names for `version` and `flags` are hypotheses: the samples only show values 1 and 2 and values 0 and 1.
- The meaning of `kind` is unknown.
- Up to two records per sample hold high-entropy data that is not compressed. They are reported as possibly-encrypted and not analyzed.
