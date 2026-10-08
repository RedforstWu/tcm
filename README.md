# 伤寒金匮 · 陈傅互动学习站

基于宋本《伤寒论》、《金匮要略》、桂林古本《伤寒杂病论》，以及陈士铎《辨证录》《石室秘录》《本草新编》、傅青主《女科》《男科》结构化数据的中医学习站点。

- 经方：最小差异方剂对对比加减，观察单味药场景
- 陈傅：方解中的药物作用 + 《本草新编》药性对照阅读

## 技术栈

- Vite + React + TypeScript + Tailwind CSS
- Font Awesome Free、ECharts、MiniSearch、OpenCC

## 开发

```bash
npm install
npm run data:build
npm run dev
```

## 数据脚本

- `npm run data:fetch` — 从维基文库抓取原文（API 限流时自动改 action=raw）
- `npm run data:parse` — 解析条文与方剂
- `npm run data:enrich:prepare` — 导出陈傅大模型抽取输入批次（可跟书名，如 `funvke`）
- `npm run data:enrich:validate` — 校验 subagent 输出并合并缓存
- `npm run data:build` — 生成 `public/data/*.json`
- `npm test` — 解析 / 药名 / 关系单测

## 说明

- 古籍文本来自维基文库，属公有领域
- 证候标签与方解作用含规则/大模型草稿（`ai-draft`），需人工校对
- 陈士铎著作含托名成分；《傅青主女科》与《辨证录》妇科大量重合
- 经方剂量并列考古/教材两种口径；陈傅方用清制钱两
