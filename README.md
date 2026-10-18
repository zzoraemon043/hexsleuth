# hexsleuth

**Hand your agent a few sample files. Get back the format.**

hexsleuth lets AI coding agents work out the structure of unknown binary file formats. Give it several samples of the same kind of file, and it returns a written specification, a Kaitai Struct definition, a parser and tests, each backed by evidence from the bytes.

[English](#english) | [繁體中文](#繁體中文)

> Status: early development, version 0.1.1. Read [docs/responsible-use.md](docs/responsible-use.md) before you use it.

---

## English

### Why

Tools such as ImHex, 010 Editor and Kaitai Struct are excellent once you know the layout. Finding the layout is still manual work: compare hex dumps, guess which bytes are lengths or offsets, test the guess, repeat. hexsleuth turns that loop into tools an agent can call, and keeps every conclusion tied to the bytes that support it.

### Tools

Every tool is available through MCP and through the CLI, with the same JSON input and output.

| Tool | What it does |
| --- | --- |
| `probe` | magic numbers, entropy per block, printable strings with offsets, alignment, padding, repeated patterns |
| `compare` | constant and variable regions aligned at the start and at the end, and the region whose length tracks the file size |
| `infer_fields` | candidate magic, length, record-chain, count, offset, version and endianness fields, each with supporting samples, byte ranges, the check used and a confidence from 0 to 1 |
| `detect_compression` | zlib, gzip, raw deflate, LZ4 frames and Zstandard frames at an offset; decompressed bytes go to a work directory |
| `verify_layout` | parse every sample with a candidate layout in [layout JSON](docs/layout.md): parsed tree, first failing field, unread bytes |
| `read_bytes` | hex and ASCII view of a range, with optional integer and float interpretation |
| `emit` | Markdown specification, Kaitai Struct `.ksy`, TypeScript parser and Vitest tests that parse every sample |

High-entropy data that no supported compression explains is reported as `possibly-encrypted`. hexsleuth never attempts decryption, key search, XOR guessing or any bypass of protection.

### Install

Requires Node.js 22.12 or later.

```sh
npm install -g hexsleuth
```

To run from source instead:

```sh
git clone https://github.com/zzoraemon043/hexsleuth.git
cd hexsleuth
npm ci
npm run build
npm link
```

### Use with an MCP client

Start the server on standard input and output with `hexsleuth mcp`. For a client that reads an `mcpServers` configuration:

```json
{
  "mcpServers": {
    "hexsleuth": {
      "command": "node",
      "args": ["/absolute/path/to/hexsleuth/dist/cli/main.js", "mcp"]
    }
  }
}
```

Register it as a stdio MCP server in your AI coding agent. The command is: `node /absolute/path/to/hexsleuth/dist/cli/main.js mcp`

### Use from the command line

```sh
hexsleuth <tool> '<json input>'
hexsleuth <tool> --input input.json
hexsleuth <tool> -
hexsleuth tools
```

`hexsleuth tools` prints every tool with its JSON Schema. Output is JSON on standard output; errors are `{ "error": "..." }` on standard error with exit code 1.

### Example

This is real output from the repository fixtures (`npm run fixtures`): six samples of HXSF, a format made up for the tests. Arrays are shortened.

```sh
hexsleuth infer_fields '{"files":["fixtures/hxsf/sample-1.hxsf","fixtures/hxsf/sample-2.hxsf","fixtures/hxsf/sample-3.hxsf","fixtures/hxsf/sample-4.hxsf","fixtures/hxsf/sample-5.hxsf","fixtures/hxsf/sample-6.hxsf"]}'
```

One of the findings:

```json
{
  "id": "count@start:12:u4le",
  "kind": "count",
  "field": { "anchor": "start", "position": 12, "label": "0x000c", "type": "u4le" },
  "claim": "u4le at 0x000c counts 20-byte records in a table that starts at u4le at 0x0010 (32) and ends at the offset in u4le at 0x0014",
  "check": "u4le at 0x0014 equals 32 + 20 x value in 6 of 6 samples (6 distinct counts)",
  "confidence": 0.9,
  "supportingSamples": ["fixtures/hxsf/sample-1.hxsf", "fixtures/hxsf/sample-2.hxsf", "..."],
  "evidence": [
    { "sample": "fixtures/hxsf/sample-1.hxsf", "range": { "offset": 12, "length": 4 }, "value": 1, "detail": "32 + 20 x 1 = 52" },
    { "sample": "fixtures/hxsf/sample-2.hxsf", "range": { "offset": 12, "length": 4 }, "value": 3, "detail": "32 + 20 x 3 = 92" }
  ],
  "limits": [],
  "related": ["offset@start:20:u4le", "offset@start:16:u4le"]
}
```

After writing a layout from such findings, verify it against every sample:

```sh
hexsleuth verify_layout '{"files":["fixtures/hxsf/sample-1.hxsf","fixtures/hxsf/sample-2.hxsf","fixtures/hxsf/sample-3.hxsf","fixtures/hxsf/sample-4.hxsf","fixtures/hxsf/sample-5.hxsf","fixtures/hxsf/sample-6.hxsf"],"layoutFile":"examples/layouts/hxsf.json","includeTree":false}'
```

```json
{
  "layout": "hxsf",
  "samples": [
    { "file": "fixtures/hxsf/sample-1.hxsf", "size": 202, "ok": true, "error": null, "readBytes": 202, "unreadBytes": 0, "unread": [] }
  ],
  "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 6 }
}
```

Then `emit` writes the specification, `.ksy`, parser and tests. The full sessions are in [docs/showcases/](docs/showcases/): [PNG](docs/showcases/png.md), [ZIP](docs/showcases/zip.md), [WAV](docs/showcases/wav.md) and [HXSF](docs/showcases/hxsf.md).

### Documentation

- [docs/spec.md](docs/spec.md): design
- [docs/layout.md](docs/layout.md): layout JSON
- [docs/fixtures.md](docs/fixtures.md): generated test fixtures
- [docs/showcases/](docs/showcases/): step-by-step sessions
- [docs/responsible-use.md](docs/responsible-use.md): what hexsleuth will not do

### Development

```sh
npm ci
npm test
npm run lint
npm run build
```

Tests generate their fixtures first; `npm run fixtures` writes them to `fixtures/` for manual use. The tests also compile every emitted `.ksy` file with the Kaitai Struct compiler and run every emitted Vitest file.

### License

[MIT](LICENSE)

---

## 繁體中文

**丟幾個樣本檔給 AI，它幫你把檔案格式找出來。**

hexsleuth 讓 AI 寫程式工具能分析未知的二進位檔案格式。提供幾個同類型的樣本檔，它會產出格式規格書、Kaitai Struct 定義檔、解析程式與測試，每一項結論都附上來自位元組的證據。

### 為什麼需要它

ImHex、010 Editor、Kaitai Struct 都是很好的工具，但前提是你已經知道格式長什麼樣子。找出格式這一步仍然要靠人工：比對十六進位內容、猜哪些位元組是長度或偏移、驗證、再重來。hexsleuth 把這個循環做成 AI 可以呼叫的工具，並讓每個結論都對應到支持它的位元組。

### 工具

每個工具都能透過 MCP 與命令列使用，兩者的 JSON 輸入與輸出完全相同。

| 工具 | 功能 |
| --- | --- |
| `probe` | 魔術數字、每區塊熵值、可讀字串與位置、對齊、填充、重複樣式 |
| `compare` | 從檔頭與檔尾對齊比對，找出固定區段、變動區段，以及長度跟著檔案大小變化的區段 |
| `infer_fields` | 推導魔術數字、長度、連續記錄、數量、偏移、版本與位元組序欄位，每項附上支持的樣本、位元組範圍、檢查方式與 0 到 1 的信心分數 |
| `detect_compression` | 偵測指定位置的 zlib、gzip、raw deflate、LZ4 frame 與 Zstandard frame，解壓結果寫入工作目錄 |
| `verify_layout` | 用 [layout JSON](docs/layout.md) 描述的候選結構解析每個樣本：解析樹、第一個失敗的欄位、沒讀到的位元組 |
| `read_bytes` | 指定範圍的十六進位與 ASCII 檢視，可選擇以整數或浮點數解讀 |
| `emit` | 產出 Markdown 規格書、Kaitai Struct `.ksy`、TypeScript 解析程式，以及能解析所有樣本的 Vitest 測試 |

無法以支援的壓縮格式解釋的高熵資料，一律回報為 `possibly-encrypted`。hexsleuth 不會嘗試解密、搜尋金鑰、猜測 XOR，也不會繞過任何保護。

### 安裝

需要 Node.js 22.12 以上。

```sh
npm install -g hexsleuth
```

如果要從原始碼執行：

```sh
git clone https://github.com/zzoraemon043/hexsleuth.git
cd hexsleuth
npm ci
npm run build
npm link
```

### 搭配 MCP 用戶端

用 `hexsleuth mcp` 在標準輸入輸出啟動伺服器。若用戶端讀取 `mcpServers` 設定：

```json
{
  "mcpServers": {
    "hexsleuth": {
      "command": "node",
      "args": ["/absolute/path/to/hexsleuth/dist/cli/main.js", "mcp"]
    }
  }
}
```

在你的 AI 代理中把它註冊為 stdio MCP 伺服器，指令為：`node /absolute/path/to/hexsleuth/dist/cli/main.js mcp`

### 命令列用法

```sh
hexsleuth <tool> '<json input>'
hexsleuth <tool> --input input.json
hexsleuth <tool> -
hexsleuth tools
```

`hexsleuth tools` 會列出所有工具與 JSON Schema。結果以 JSON 輸出到標準輸出；錯誤以 `{ "error": "..." }` 輸出到標準錯誤，結束碼為 1。

### 範例

以下是倉庫測試資料（`npm run fixtures` 產生）的實際輸出：六個 HXSF 樣本，HXSF 是專為測試設計的格式。陣列已縮短。

```sh
hexsleuth infer_fields '{"files":["fixtures/hxsf/sample-1.hxsf","fixtures/hxsf/sample-2.hxsf","fixtures/hxsf/sample-3.hxsf","fixtures/hxsf/sample-4.hxsf","fixtures/hxsf/sample-5.hxsf","fixtures/hxsf/sample-6.hxsf"]}'
```

其中一項結論：

```json
{
  "id": "count@start:12:u4le",
  "kind": "count",
  "field": { "anchor": "start", "position": 12, "label": "0x000c", "type": "u4le" },
  "claim": "u4le at 0x000c counts 20-byte records in a table that starts at u4le at 0x0010 (32) and ends at the offset in u4le at 0x0014",
  "check": "u4le at 0x0014 equals 32 + 20 x value in 6 of 6 samples (6 distinct counts)",
  "confidence": 0.9,
  "supportingSamples": ["fixtures/hxsf/sample-1.hxsf", "fixtures/hxsf/sample-2.hxsf", "..."],
  "evidence": [
    { "sample": "fixtures/hxsf/sample-1.hxsf", "range": { "offset": 12, "length": 4 }, "value": 1, "detail": "32 + 20 x 1 = 52" },
    { "sample": "fixtures/hxsf/sample-2.hxsf", "range": { "offset": 12, "length": 4 }, "value": 3, "detail": "32 + 20 x 3 = 92" }
  ],
  "limits": [],
  "related": ["offset@start:20:u4le", "offset@start:16:u4le"]
}
```

意思是：位移 12 的 u4le 是 20 位元組記錄的數量，記錄表從位移 16 欄位所指的 32 開始，結束在位移 20 欄位所指的位置；六個樣本都符合，信心分數 0.9。

根據這些結論寫出 layout 後，用所有樣本驗證：

```sh
hexsleuth verify_layout '{"files":["fixtures/hxsf/sample-1.hxsf","fixtures/hxsf/sample-2.hxsf","fixtures/hxsf/sample-3.hxsf","fixtures/hxsf/sample-4.hxsf","fixtures/hxsf/sample-5.hxsf","fixtures/hxsf/sample-6.hxsf"],"layoutFile":"examples/layouts/hxsf.json","includeTree":false}'
```

```json
{
  "layout": "hxsf",
  "samples": [
    { "file": "fixtures/hxsf/sample-1.hxsf", "size": 202, "ok": true, "error": null, "readBytes": 202, "unreadBytes": 0, "unread": [] }
  ],
  "summary": { "samples": 6, "parsed": 6, "failed": 0, "fullyRead": 6 }
}
```

最後用 `emit` 產出規格書、`.ksy`、解析程式與測試。完整的分析過程請見 [docs/showcases/](docs/showcases/)：[PNG](docs/showcases/png.md)、[ZIP](docs/showcases/zip.md)、[WAV](docs/showcases/wav.md)、[HXSF](docs/showcases/hxsf.md)（英文）。

### 文件

- [docs/spec.md](docs/spec.md)：設計
- [docs/layout.md](docs/layout.md)：layout JSON
- [docs/fixtures.md](docs/fixtures.md)：自動產生的測試資料
- [docs/showcases/](docs/showcases/)：逐步示範
- [docs/responsible-use.md](docs/responsible-use.md)：hexsleuth 不會做的事

### 開發

```sh
npm ci
npm test
npm run lint
npm run build
```

測試會先產生測試資料；`npm run fixtures` 會把它們寫到 `fixtures/` 供手動使用。測試也會用 Kaitai Struct 編譯器編譯每個產出的 `.ksy`，並實際執行每個產出的 Vitest 測試。

### 使用前請先閱讀

[docs/responsible-use.md](docs/responsible-use.md)：只分析你有權使用的檔案。

### 授權

[MIT](LICENSE)
