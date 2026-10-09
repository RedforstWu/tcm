# 新古籍接入规范（本体化）

新增一部古籍时，按下列步骤操作。目标是：**只加配置与解析器，不改页面与核心类型**。

## 1. 注册书目

编辑 [`data/ontology/books.json`](../data/ontology/books.json)，追加一条：

| 字段 | 说明 |
|------|------|
| `id` | 稳定短 id，如 `wenbing` |
| `title` / `shortName` / `fullTitle` | 展示名 |
| `corpus` | `jingfang` / `chenfu` / `bencao` / `wenbing` / `jinyuan` / `mingqing` / `yian` / `modern` |
| `school` | 流派，用于概念 `schoolNotes` |
| `parser` | 解析器键，须在 `scripts/lib/parser-dispatch.ts` 注册 |
| `hasClauses` | 是否产出条文 JSON |
| `doseSystem` | `han` / `qing` |
| `sourceUrl` | 原文出处 |

然后运行：

```bash
npm run ontology:gen-books
```

会生成 [`src/types/books.generated.ts`](../src/types/books.generated.ts)。

## 2. 实现解析器

在 `scripts/parse/<id>.ts` 实现 `runXxxParse()`，契约：

- 输入：`data/raw/*.wiki`（可用 `npm run data:fetch` 扩展 `fetch-sources.ts`）
- 输出：`{ clauses?: Clause[], formulas?: Formula[], monographs?: HerbMonograph[], stats? }`
- 条文 id：`{bookId}-...`（数字或章节序号）
- 方剂 id：`{bookId}-formula-...`

在 [`scripts/lib/parser-keys.ts`](../scripts/lib/parser-keys.ts) 与 [`scripts/lib/parser-dispatch.ts`](../scripts/lib/parser-dispatch.ts) 登记。可复用 [`scripts/lib/generic-wiki-parse.ts`](../scripts/lib/generic-wiki-parse.ts)。

抓取示例（仅新书）：

```bash
npx tsx scripts/fetch-sources.ts shennong wenbing
```

## 3. 补概念词表

词表位于 `data/ontology/concepts/{symptom,pulse,pathogenesis,channel,organ,method}.json`。

- 新增表面词优先挂到已有概念的 `altLabels`（需人工确认同义）
- 新概念：`id` = `{type}.{prefLabel}`，`reviewStatus` 默认 `ai-draft`
- 跨流派同名异义：不要合并，用 `schoolNotes` 记录差异

初稿可从历史 TS 词表导出：

```bash
npm run ontology:migrate-lexicon
```

## 4. 构建与未映射报表

```bash
npm run data:build
```

查看：

- `data/ontology/unmapped.json`：LLM/规则标签未能映射的表面词
- `public/data/graph/`：节点与分类型边
- `public/data/concepts.json`：前端概念页数据
- `public/data/validation.json`：含 `graph` 统计与 `unmappedCount`

## 5. 学习路径（可选）

编辑 [`data/ontology/curriculum.json`](../data/ontology/curriculum.json)，用方名与 `prerequisite` 描述先修关系。测验页会基于条文→方、加减症状差、药物→方出题，并附出处链接。

## 解析器检查清单

- [ ] `books.json` 已登记且 `npm run ontology:gen-books` 已跑
- [ ] parser 已挂到 `PARSER_MAP`
- [ ] id 规则稳定、可复现
- [ ] `data:build` 通过
- [ ] `unmapped.json` 已人工过一遍高频项
- [ ] 现有 `npm test` 通过
