# Layout JSON

hexsleuth layout JSON describes a candidate format. `verify_layout` parses samples with it and `emit` turns a verified layout into a specification, a Kaitai Struct `.ksy` file, a TypeScript parser and tests. Every construct maps one to one onto Kaitai Struct.

## Top level

| Key | Required | Meaning | Kaitai |
| --- | --- | --- | --- |
| `id` | yes | snake_case name of the format | `meta.id` |
| `endian` | yes | `le` or `be`, the default byte order | `meta.endian` |
| `title` | no | human readable name | `meta.title` |
| `fileExtension` | no | usual extension | `meta.file-extension` |
| `doc` | no | description | `doc` |
| `seq` | no | fields read in order from the start of the file | `seq` |
| `instances` | no | fields read at an absolute position | `instances` |
| `types` | no | named structures used as field types | `types` |

## Fields

| Key | Meaning | Kaitai |
| --- | --- | --- |
| `id` | snake_case name | `id` |
| `type` | `u1` `u2` `u4` `u8` `s1` `s2` `s4` `s8` `f4` `f8`, each with an optional `le` or `be` suffix; `bytes`; `str`; `strz`; or a name from `types` | `type` (no type for `bytes`) |
| `endian` | override the byte order of this field | `type: u4le` |
| `size` | number or expression, required for `bytes` and `str` | `size` |
| `sizeEos` | read to the end of the current stream | `size-eos: true` |
| `encoding` | for `str` and `strz`, for example `ASCII` or `UTF-8` | `encoding` |
| `contents` | expected bytes, as an array of numbers or an ASCII string | `contents` |
| `repeat` | `eos` or `expr` | `repeat` |
| `repeatExpr` | number of items when `repeat` is `expr` | `repeat-expr` |
| `if` | read the field only when the expression is true | `if` |
| `process` | `zlib` to inflate the bytes before use | `process: zlib` |
| `doc` | description | `doc` |

Instances take the same keys without `id` (the key in `instances` is the name) and add `pos`, the position in the current stream. A user type without `size` shares its parent's stream, so `pos` inside it is an absolute file offset.

## Expressions

Expressions use the Kaitai Struct expression syntax:

- integers in decimal or `0x` hex, strings in double or single quotes, `true`, `false`
- field and instance names of the current type, `_parent`, `_root`, `_io.size`, `_io.pos`, `_io.eof`
- member access `a.b`, indexing `a[0]`, `.size` of arrays and byte arrays, `.length` of strings
- `+ - * / %` (integer division and a non-negative modulo, as in Kaitai), comparisons, `and`, `or`, `not`

## Verification output

For each sample `verify_layout` returns:

- `ok` and, on failure, `error` with the field path, the absolute offset and the reason
- `tree`: every field read, with offset, size and value or a hex preview
- `unread`: byte ranges that no field read; bytes inside a sized structure that its fields do not read count as unread
- `readBytes` and `unreadBytes`

Bytes produced by `process: zlib` are a derived stream. They appear in the tree but do not count toward the file coverage, which always refers to bytes in the file.

## Examples

See `examples/layouts/` for PNG, ZIP, WAV and HXSF layouts. Each parses every generated fixture and reads every byte.
