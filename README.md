# hexsleuth

**Hand your agent a few sample files. Get back the format.**

hexsleuth lets AI coding agents work out the structure of unknown binary file formats. Give it several samples of the same kind of file, and it returns a written specification, a Kaitai Struct definition, a parser and tests, each backed by evidence from the bytes.

[English](#english) | [繁體中文](#繁體中文)

> Status: early development. The design is in [docs/spec.md](docs/spec.md). Read [docs/responsible-use.md](docs/responsible-use.md) before you use it.

---

## English

### Why

Tools such as ImHex, 010 Editor and Kaitai Struct are excellent once you know the layout. Finding the layout is still manual work: compare hex dumps, guess which bytes are lengths or offsets, test the guess, repeat. hexsleuth turns that loop into tools an agent can call, and keeps every conclusion tied to the bytes that support it.

### Planned features

- Probe: magic numbers, entropy map, printable strings, alignment and padding
- Compare samples: constant regions, variable regions and fields that change together
- Infer fields: lengths, counts, offsets that point inside the file, endianness, version fields
- Test hypotheses: apply a candidate layout to every sample and report where it breaks
- Detect standard compression such as zlib, gzip, LZ4 and Zstandard, and decompress it for analysis
- Flag high-entropy regions that look encrypted, without attempting to decrypt them
- Emit a Markdown specification, a Kaitai Struct `.ksy` file, a TypeScript parser and tests
- MCP server for AI coding agents, plus a CLI for the same workflows

### License

[MIT](LICENSE)

---

## 繁體中文

**丟幾個樣本檔給 AI，它幫你把檔案格式找出來。**

hexsleuth 讓 AI 寫程式工具能分析未知的二進位檔案格式。提供幾個同類型的樣本檔，它會產出格式規格書、Kaitai Struct 定義檔、解析程式與測試，每一項結論都附上來自位元組的證據。

### 為什麼需要它

ImHex、010 Editor、Kaitai Struct 都是很好的工具，但前提是你已經知道格式長什麼樣子。找出格式這一步仍然要靠人工：比對十六進位內容、猜哪些位元組是長度或偏移、驗證、再重來。hexsleuth 把這個循環做成 AI 可以呼叫的工具，並讓每個結論都對應到支持它的位元組。

### 規劃中的功能

- 初步探測：魔術數字、熵值分布、可讀字串、對齊與填充
- 樣本比對：固定區段、變動區段，以及會一起變動的欄位
- 欄位推導：長度、數量、指向檔案內部的偏移、位元組序、版本欄位
- 假設驗證：把候選結構套用到所有樣本，回報在哪裡失敗
- 偵測 zlib、gzip、LZ4、Zstandard 等標準壓縮，並解壓以便分析
- 標出看起來像加密的高熵區段，但不嘗試解密
- 產出 Markdown 規格書、Kaitai Struct `.ksy`、TypeScript 解析程式與測試
- 提供 MCP 伺服器給 AI 寫程式工具使用，也提供功能相同的命令列工具

### 使用前請先閱讀

[docs/responsible-use.md](docs/responsible-use.md)：只分析你有權使用的檔案。

### 授權

[MIT](LICENSE)
