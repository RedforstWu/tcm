# 优化方案

依据：`d:\Documents\Downloads\tcm-优化报告.docx`（2026-10-10 访客测试）。只做报告里的 7 个问题。图谱、可视化、测验、药物详情、繁体、移动端不在本轮。

不改决策树的选方结果。树来自讲义，报告要求的是标签、安全提示、匹配、检索和校注，不是重写「感冒 → 某方」。

不新写可执行的服药剂量或现代禁忌清单。选方结果页不展示剂量、服法或药单。

## 问题与改法

### P0-1 葛根汤 AI 标签与方性指数

现状：

- 源数据在 `data/reasoning/formulas.json`，构建命令 `npm run data:reasoning`，页面读 `public/data/reasoning.json`。
- 葛根汤功效现为「祛风解肌，和血通脉」。
- 大枣含「热、降」，桂枝、生姜、芍药含「补」。这些标签来自通用中药作用，和葛根汤方义不符。
- `scripts/lib/reasoning.ts` 的 `computeNatureIndex` 会按药味权重算出 0–1 的指数。`public/data/reasoning.json` 里葛根汤 `natureIndex` 已经非零（补约 0.8636，热约 0.6364，十项都有数）。`NatureChart.tsx` 的柱状图系列已经绑定这些值。本轮不把「加标题、保证系列有值」当作修复。

改法：

- 只校对葛根汤这一张卡片，并把它的 `reviewStatus` 改为 `reviewed`。
- 功效改为「发汗解表，升津舒筋」（对应宋本第 31、32 条：无汗恶风、项背强、下利）。
- 药性只改报告点名的错误：
  - 大枣去掉「热」「降」，保留「补」「润」。
  - 桂枝、生姜、芍药去掉「补」。其余标签不动。
  - 葛根去掉「补」，保留「升」「散」。
- 其余 11 张卡片保持 `ai-draft`。`reviewStatus !== 'reviewed'` 时不展示功效句、药性标签和方性图，改为一句「功效与药性尚未校对，暂不展示」。条文、主症、药物名仍显示。`src/components/reasoning/CompareView.tsx` 的对照卡片同样不展示未校对功效句。
- 桂枝汤现有单测「lecture indices」不要改，因为桂枝汤药性数据本轮不动。

### P0-2 选方结果的就医提示

现状：`DraftBanner` 只说明标签是 AI 草稿。结果页没有就医提示。决策树里有「月经期感冒 → 小柴胡汤」。

改法：

- 只要出现方剂结果，就显示固定提示：「请就医，遵医嘱。此处按讲义症状检索方剂，不能代替诊疗。」
- 路径文字含「月经」或「经期」时，再加一句：「经期用药须由医师决定。」
- 结果页不展示剂量、服法或药单。不新增现代禁忌药单。

### P1-3 组方匹配计入剂量

现状：`src/pages/LabPage.tsx` 的加减推演只用药物集合的 Jaccard。桂枝汤、桂枝加桂汤、桂枝加芍药汤药味相同，所以未加减时都是 100%。

宋本剂量（`public/data/formulas.json`）：

- 桂枝汤：桂枝三两、芍药三两、甘草二两、生姜三两、大枣十二枚。
- 桂枝加桂汤：桂枝五两，其余与桂枝汤相同。
- 桂枝加芍药汤：芍药六两，其余与桂枝汤相同。

改法：

- 把匹配从页面里抽到纯函数。分数 = 药味 Jaccard × 共有药的剂量相似均值。
- 同一单位用 `min/max`。`doseLiang` 与 `doseCount` 分开比，不能互比。
- 两边剂量都不可比时，该味不记 1，并在说明里写出「剂量不明」。
- 药味相同、剂量不同时，分数必须小于 1，并写明差异，例如「桂枝：三两 / 五两」。
- 完全相同仍为 1。
- 按上面剂量手算：桂枝加桂汤剂量因子 (0.6+1+1+1+1)/5 = 0.92；桂枝加芍药汤 (1+0.5+1+1+1)/5 = 0.90。单测用这两个数。
- 勾选药物匹配（没有剂量输入）仍只比药味。剂量规则只用在「加减推演」。

### P1-5 检索支持 q

现状：`src/pages/SearchPage.tsx` 的查询只在组件 state，忽略 `?q=`。

改法：

- 进入页面时读取 `q` 并检索。
- 输入变化时用 `replace` 写回 `?q=`。空查询去掉该参数。
- 纯函数负责解析和生成查询字符串，页面只负责绑定。

### P1-6 检索出处用中文

现状：`buildSearchDocs` 把 `type` 存成 `clause`，`book` 存成 `songben`，标题也带书目 id，所以结果像 `clause / songben / danxi·痞三十四·3`。

改法：

- 不改搜索索引结构。
- 展示时映射：`clause`→条文，`formula`→方剂，`herb`→药物，`fangjie`→方解，`monograph`→本草。
- 书目用 `bookShortName`：宋本、丹溪，不用 id。
- 标题若以书目 id 开头，换成简称。

### P2-7 药物筛选合并别名

现状：`FormulasPage` 用 `herbs.slice(0, 80)`。前 80 名里同时有芍药/白芍、黄芪/黄茋、熟地黄/熟地。报告写的「黄茗」就是数据里的「黄茋」。

改法：

- 只合并这三组。甘草与炙甘草、生甘草保持分开。桂枝、肉桂、桂心保持分开。
- 下拉显示一个条目，并注明别名，例如「芍药（白芍）」。
- 选中后，方剂里任一别名 id 都算命中。

### P2-4 桂枝加葛根汤校注

现状：宋本方剂含麻黄，与原文方后药物一致。条款正文只有「桂枝加葛根汤主之」，林亿校语没有进入解析结果。

改法：

- 不删除麻黄，不改组成。
- 方剂详情对 `songben-formula-桂枝加葛根汤` 显示校注：「汗出恶风而方中有麻黄。林亿等认为与无汗用麻黄之例不合，怀疑只是桂枝汤加葛根。组成仍按宋本保留麻黄。」
- 注明出处：宋本《伤寒论》林亿等校注，第 14 条方后。

## 测试缝（先红后绿，一次一条）

项目没有 React Testing Library。测纯函数，页面只做接线。浏览器再核对选方、检索、方剂筛选、方剂详情、组方实验室。

| 顺序 | 缝 | 文件 | 必须失败的断言 |
| --- | --- | --- | --- |
| 1 | 葛根汤校对 | `scripts/lib/reasoning-review.test.ts` | 功效为「发汗解表，升津舒筋」；大枣无热/降；桂枝、生姜、芍药、葛根无补 |
| 2 | 未校对不展示 | `src/lib/reasoning-display.test.ts` | `ai-draft` 隐藏功效、药性、方性图；`reviewed` 展示。对照页走同一规则 |
| 3 | 就医提示 | `src/lib/reasoning-safety.test.ts` | 有结果必有就医句；路径含经期则多一句；结果文案不出现剂量、服法和药单 |
| 4 | 剂量匹配 | `src/lib/formula-match.test.ts` | 桂枝加桂汤 0.92 且注明桂枝三两/五两；桂枝加芍药汤 0.90；相同方为 1 |
| 5 | 检索参数与出处 | `src/lib/search-presentation.test.ts` | `q` 往返；`clause`+`songben` 显示「条文」「宋本」 |
| 6 | 药名合并 | `src/lib/herb-groups.test.ts` | 三组合并；甘草筛选不带出炙甘草 |
| 7 | 校注 | `src/lib/formula-collation.test.ts` | 该方有林亿说明；函数不修改药物列表 |

每条先写失败测试，再写最少实现。不要先把 7 个测试一次性写完。

## 要改的文件

- `data/reasoning/formulas.json`：只改葛根汤。
- `public/data/reasoning.json`：由 `npm run data:reasoning` 生成，不手改。
- `src/lib/reasoning-display.ts`、`src/lib/reasoning-safety.ts`：新建。
- `src/components/reasoning/ReasoningChain.tsx`、`src/pages/ReasoningPage.tsx`、`src/components/reasoning/CompareView.tsx`：按校对状态接线。不改 `NatureChart.tsx`。
- `src/lib/formula-match.ts`、`src/pages/LabPage.tsx`。
- `src/lib/search-presentation.ts`、`src/pages/SearchPage.tsx`。
- `src/lib/herb-groups.ts`、`src/pages/FormulasPage.tsx`。
- `src/lib/formula-collation.ts`、`src/pages/FormulaDetailPage.tsx`。
- 上表中的测试文件。

## 完成标准

- 上述单测通过。
- 浏览器：葛根汤结果不再出现错误功效和错误药性；柱高须与校对后的方性指数一致。若柱状图仍空白，本轮不算完成，另查渲染。经期分支有加强提示，结果页不出现剂量、服法或药单。对照页不显示未校对功效。`/search?q=桂枝汤` 打开即有结果，出处为中文；药物筛选三组合并；桂枝加葛根汤详情有校注且仍含麻黄；加减推演里桂枝加桂汤、桂枝加芍药汤不是 100%。
