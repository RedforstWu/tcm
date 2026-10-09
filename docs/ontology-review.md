# 本体化改造 — 独立评审与修复记录

## 复评结论（修复前）

[独立评审本体化落地](ef9a575c-0042-4bff-b541-f85b69b21e26)：**有条件通过 ~82%**

## 已修复项（本轮）

1. **Quiz**：按 `curriculum.units` 的方名与 `conceptIds` 过滤出题池
2. **rematch**：未命中词表不再伪造 concept id；补单测；霍乱从经络标签改为病机 `pathogenesis.霍乱`
3. **Reader**：优先用 `clause.conceptIds` 跳转概念页
4. **treatsConcept**：条文所引方 ↔ 症状/病机 边已产出；少阳/三焦/霍乱补了 `schoolNotes`
5. **解析器键**：`scripts/lib/parser-keys.ts` 作为 `REGISTERED_PARSERS` 单一来源
6. **prerequisite**：按方名优先取宋本/金匮，避免跨书笛卡尔积

## 验证

- `npm test`：141 passed
- `data:build`：`graphEdges≈51995`，含 `edges-treatsConcept.json`
