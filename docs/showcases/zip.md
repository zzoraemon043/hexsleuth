# ZIP local headers and central directory

Goal: find how a ZIP archive locates its files, starting from six generated archives with one to five entries, some stored and some deflated.

```sh
ZIP='["fixtures/zip/sample-1.zip","fixtures/zip/sample-2.zip","fixtures/zip/sample-3.zip","fixtures/zip/sample-4.zip","fixtures/zip/sample-5.zip","fixtures/zip/sample-6.zip"]'
```

## Step 1: probe one sample

```sh
hexsleuth probe '{"file":"fixtures/zip/sample-3.zip","maxStrings":8,"maxBlocks":3}'
```

Excerpt:

```json
{
  "size": 672,
  "magic": [{ "offset": 0, "bytes": "50 4b 03 04", "name": "ZIP local file header", "confidence": 0.9 }],
  "strings": [
    { "offset": 30, "length": 15, "text": "dir2/file-0.txt" },
    { "offset": 114, "length": 180, "text": "dir2/file-1.txtformat length format length value evidence record ..." },
    { "offset": 325, "length": 16, "text": "dir2/file-2.txtU" }
  ],
  "entropy": { "highEntropyRegions": [] },
  "repeatedPatterns": [
    { "bytes": "14 00 00 00", "count": 6, "offsets": [4, 88, 299, 473, 534, 595] }
  ]
}
```

File names appear in the clear, one entry's content is plain text (stored), and the bytes after the other names are not printable (probably compressed, but too short to count as high entropy). The pattern `14 00 00 00` repeats six times: three entries, each named twice. That hints at a second copy of each header further on.

## Step 2: compare the end of the files

```sh
hexsleuth compare "{\"files\":$ZIP,\"maxRegions\":8}"
```

Excerpt of `fromEnd`, where offsets count back from the end of each file:

```json
[
  { "kind": "constant", "offset": 0, "length": 4, "bytes": "00 00 00 00" },
  { "kind": "variable", "offset": 4, "length": 2 },
  { "kind": "constant", "offset": 6, "length": 2, "bytes": "00 00" },
  { "kind": "variable", "offset": 8, "length": 2 },
  { "kind": "constant", "offset": 10, "length": 1, "bytes": "00" },
  { "kind": "variable", "offset": 11, "length": 1 },
  { "kind": "constant", "offset": 12, "length": 1, "bytes": "00" },
  { "kind": "variable", "offset": 13, "length": 1 }
]
```

The last 22 bytes alternate between small varying values and zeros: it looks like a fixed-size trailer of little-endian integers. Header-first formats rarely have this, so the next step scans the end of the files as well as the start.

## Step 3: infer fields, including the end of the file

`infer_fields` scans the last 64 bytes by default (`endScanLength`), and labels those fields `end-N`, the distance from the end.

```sh
hexsleuth infer_fields "{\"files\":$ZIP}"
```

Excerpt of `findings`:

```json
[
  { "kind": "offset", "field": { "label": "end-6", "type": "u4le" }, "confidence": 0.99,
    "claim": "u4le at end-6 is an absolute offset that points inside the file",
    "check": "points to the same bytes 50 4b 01 02 in 6 of 6 samples; value + u4le at end-10 equals file size minus 22 in 6 of 6 samples",
    "evidence": [{ "sample": "fixtures/zip/sample-1.zip", "range": { "offset": 166, "length": 4 }, "value": 89,
                   "detail": "points to 0x0059 of 172 bytes, which starts with 50 4b 01 02" }] },
  { "kind": "count", "field": { "label": "end-12", "type": "u2le" }, "confidence": 0.85,
    "claim": "u2le at end-12 counts 61-byte records whose total size is in u4le at end-10",
    "check": "u4le at end-10 equals 0 + 61 x value in 6 of 6 samples (5 distinct counts); value equals the number of occurrences of 50 4b 03 04 in 6 of 6 samples (5 distinct counts)",
    "limits": ["the marker could also appear inside data by chance; confirm with an offset table or a layout"] },
  { "kind": "length", "field": { "label": "end-10", "type": "u4le" }, "confidence": 0.75,
    "claim": "u4le at end-10 holds the size of the region that starts at the offset in u4le at end-6",
    "check": "u4le at end-6 + value equals file size minus 22 in 6 of 6 samples" },
  { "kind": "version", "field": { "label": "0x0004", "type": "u2le" }, "confidence": 0.5,
    "check": "small value (20) directly after the magic bytes in 6 of 6 samples",
    "limits": ["the value is the same in every sample; samples written by other versions are needed to tell a version from another constant"] }
]
```

Reading the evidence critically:

- `end-6` points at `PK 01 02`, a second signature, and the region it starts ends exactly 22 bytes before the end of the file. So the file ends with a 22-byte trailer that holds the offset and the size of a directory.
- `end-12` (and `end-14`) count the entries: the value equals the number of `PK 03 04` local headers.
- The count finding also says every directory record is 61 bytes. That is true only because every file name in these samples has 15 characters. The check is correct for the samples and wrong for ZIP in general, which is why a hypothesis has to be verified against the structure, not just the numbers.
- The version finding at offset 4 has a stated limit: the value is 20 in every sample, so the samples cannot show that it is a version.

## Step 4: first hypothesis, reading from the start

The draft [layouts/zip-draft.json](layouts/zip-draft.json) treats the file as a sequence of local file headers, each followed by its data.

```sh
hexsleuth verify_layout "{\"files\":$ZIP,\"layoutFile\":\"docs/showcases/layouts/zip-draft.json\",\"includeTree\":false}"
```

Excerpt:

```json
{
  "samples": [
    { "file": "fixtures/zip/sample-1.zip", "ok": false,
      "error": { "path": "zip.files[1].magic", "offset": 89,
                 "message": "contents mismatch: expected 50 4b 03 04, found 50 4b 01 02" },
      "unread": [{ "offset": 93, "length": 79 }] }
  ],
  "summary": { "samples": 6, "parsed": 0, "failed": 6, "fullyRead": 0 }
}
```

The local headers parse until the directory starts, at the offset that `end-6` points to. The draft is right about the local headers and wrong about what follows them.

## Step 5: read from the trailer

The final layout, [examples/layouts/zip.json](../../examples/layouts/zip.json), follows the evidence instead of the file order:

- an instance `end_of_central_dir` at `_io.size - 22`
- an instance `central_dir` at `end_of_central_dir.central_dir_offset`, repeated `end_of_central_dir.total_entries` times
- inside each directory entry, an instance `local_file` at `local_header_offset`

```sh
hexsleuth verify_layout "{\"files\":$ZIP,\"layoutFile\":\"examples/layouts/zip.json\",\"maxArrayItems\":2}"
```

Excerpt:

```json
{ "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 6 } }
```

All six archives parse and every byte is read, which also confirms that nothing sits between the local files and the directory.

## Step 6: check an entry body

The tree of sample 3 shows that the first entry has `method` 8, `compressed_size` 39, and its `body` starts at offset 45. Raw deflate has no header, so `probe` cannot find it by signature; `detect_compression` is told where to look.

```sh
hexsleuth detect_compression '{"file":"fixtures/zip/sample-3.zip","offset":45,"length":39}'
```

Excerpt:

```json
{
  "tried": ["deflate-raw"],
  "verdict": "compressed",
  "detected": [{ "method": "deflate-raw", "offset": 45, "compressedSize": 39, "decompressedSize": 46, "complete": true,
                 "evidence": "raw deflate data inflates to the final block; raw deflate has no header or checksum, so this is weaker evidence",
                 "outputPreview": "69 6e 64 65 78 20 76 61 6c 75 65 20 68 65 61 64 65 72 20 73 61 6d 70 6c 65 20 73 61 6d 70 6c 65" }]
}
```

The stream consumes exactly the 39 bytes that `compressed_size` declares and inflates to text (`index value header sample ...`), written to `.hexsleuth-work/`. Method 8 means deflate; method 0 entries are stored as is.

## Step 7: emit

```sh
hexsleuth emit "{\"files\":$ZIP,\"layoutFile\":\"examples/layouts/zip.json\",\"outDir\":\"out/zip\"}"
npx vitest run --root out/zip
```

The generated parser reads the trailer first, exactly like the layout. The six generated tests pass, and the `.ksy` compiles with the Kaitai Struct compiler in the repository tests.

## Result and limits

- Verified: end of central directory record, central directory entries and local file headers in 6 of 6 samples, with no unread bytes.
- The layout assumes an archive without a comment, so the trailer is exactly 22 bytes. An archive with a comment needs a search for `PK 05 06`, which layout JSON cannot express.
- Not covered: ZIP64, data descriptors, encryption headers. None appear in the samples.
