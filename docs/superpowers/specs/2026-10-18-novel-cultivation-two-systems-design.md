# 新建小说：新增两套修炼体系 + detailChain 联动

## 背景

新建小说立项页（`workbench/app/pages/novel/ideate.vue`）的修炼体系选项来自 SSOT：

`workbench-server/src/common/novel/novel-cultivation-catalog.ts`

（前端经 `@huohuo-shared` 别名同一份目录。）

需要新增两套境界主链，并让用户在选中「大境界短链」卡片后，能在自定义输入框看到完整小阶链。

## 目标

1. 目录新增两条 active 修炼体系条目。
2. 目录类型增加可选 `detailChain`，用于选中后填充自定义框。
3. 选中/取消联动自定义框；注入时对「展示镜像」去重，避免同一体系写两遍。

## 非目标

- 不为全部旧条目补 `detailChain`（无该字段则行为与现网一致）。
- 不改世界观/金手指交互、多选上限（仍为 8）、API 字段名。
- 不做数据库迁移（设定仍存 metadata）。

## 数据模型

在 `NovelSettingCatalogEntry`（`novel-setting-catalog-types.ts`）增加：

```ts
/** 选中时填入自定义框的完整境界链（可选）；无则不改自定义框 */
detailChain?: string
```

其余字段不变：`id` / `label` / `summary` / `genreSkillKeys` / `injectPrompt` / `status`。

## 新增目录条目

插入位置：`cu_body_temper`（炼体肉身链）之后、`cu_xuanhuan_bloodline`（血脉品阶）之前。

### 1. `cu_eastern_xuanwu` — 东方古武玄境

| 字段 | 值 |
|------|-----|
| label | 东方古武玄境 |
| summary | `凡境-灵境-玄境-地境-天境-圣境-帝境-道境` |
| detailChain | `锻皮-锻肉-锻骨-锻髓-醒灵-聚灵-凝灵-玄士-玄师-玄将-玄王-地宗-地皇-地尊-天君-天王-天帝-半圣-圣人-圣王-大帝-天帝-帝尊-道祖-道尊` |
| genreSkillKeys | `[]` |
| status | `active` |

**injectPrompt 要点（须写清归属，避免两处「天帝」混淆）：**

- 主链用「-」连接大境界：凡境-灵境-玄境-地境-天境-圣境-帝境-道境。
- 各大境内部小阶：
  - 凡境：锻皮、锻肉、锻骨、锻髓（凡人极限）
  - 灵境：醒灵、聚灵、凝灵
  - 玄境：玄士、玄师、玄将、玄王
  - 地境：地宗、地皇、地尊
  - 天境：天君、天王、天帝
  - 圣境：半圣、圣人、圣王
  - 帝境：大帝、天帝、帝尊（帝境「天帝」与天境「天帝」须按大境区分，禁止混称导致跳境）
  - 道境：道祖、道尊
- 小境界：初期/中期/后期/巅峰/圆满；可加「半步 XX」过渡。
- 大境界之间存在天堑，跨阶极难；同境小阶可依功法、法宝、秘术越级。
- 可选设定：灵根、道基、心魔、天劫、本源法则。
- 全书只准这一套名称；禁止无铺垫跳境；偏肉身+神魂，适合低魔/高武世界。

### 2. `cu_lean_realm_ten` — 精简十境

| 字段 | 值 |
|------|-----|
| label | 精简十境 |
| summary | `锻身-聚元-凝府-化灵-王境-皇境-尊境-圣境-帝境-超脱` |
| detailChain | 与 summary 相同 |
| genreSkillKeys | `[]` |
| status | `active` |

**injectPrompt 要点：**

- 主链：锻身-聚元-凝府-化灵-王境-皇境-尊境-圣境-帝境-超脱（锤炼躯体→凝聚元气→丹田成府→诞生灵识→称王→皇道→一域至尊→成圣→证帝→跳出世界束缚）。
- 各大境分初期/中期/后期/巅峰/圆满；可加「半步 XX」。
- 大境界天堑；同境可越级（功法/法宝/秘术）。
- 适合短篇、快节奏网文；全书只准这一套名称，禁止无铺垫跳境。

## 前端联动（`ideate.vue`）

修改 `toggleCultivation(id)`：

### 选中

1. 若 `cur.length >= CULTIVATION_PICK_MAX`，保持现有 toast，不选中。
2. 将 `id` 推入 `cultivationIds`。
3. 若该条目有非空 `detailChain`：
   - 将 `detailChain` 追加到 `cultivationCustom`（多条时每条一行）。
   - 若自定义框中已存在完全相同的一行（trim 后相等），不重复追加。

### 取消选中

1. 从 `cultivationIds` 移除该 `id`。
2. 若该条目有 `detailChain`：从 `cultivationCustom` 按行删除与该 `detailChain`（trim 后）完全相等的行。
3. 用户已改写过该行（不再精确等于 `detailChain`）→ **不**自动删除，避免误清编辑。

### 无 `detailChain` 的条目

选中/取消均不改动 `cultivationCustom`（与现网一致）。

### 「自定义」卡片

`focusCustom('cultivation')` 行为不变；用户可继续手写叠加内容。

## 注入去重（`novel-setting-inject.ts` · `resolveCultivationBlock`）

在现有「目录条目 + 自定义」拼装逻辑上增加镜像过滤：

1. 收集已选条目的全部非空 `detailChain`（trim）。
2. 将 `cultivation_custom` 按行拆分；去掉空行。
3. 过滤掉与任一已选 `detailChain` 完全相等（trim）的行（视为展示镜像）。
4. 过滤后若无剩余自定义行 → 不追加「自定义：…」段；仅输出目录 `injectPrompt`（单条或「可并行多套」列表）。
5. 若有剩余自定义行 → 将剩余行重新拼成自定义文本，按现网规则追加。

不改变：单目录无自定义、仅自定义无目录、多目录并行等既有分支语义。

## 单元边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `novel-setting-catalog-types` | 类型含可选 `detailChain` | 无 |
| `novel-cultivation-catalog` | 两条新条目 + 字段填写 | types |
| `ideate.vue` toggleCultivation | 选中填充 / 取消精确移除 | catalog via listCultivations |
| `novel-setting-inject` | 自定义镜像行去重 | catalog + meta |

## 错误与边界

- 多选达上限：不选中、不写自定义框。
- 同一 `detailChain` 已在自定义框中：不重复追加。
- 用户编辑后取消选中：保留编辑后的行。
- 两处「天帝」：仅在 injectPrompt 用大境归属消歧；detailChain 按原文保留两处「天帝」。

## 验证

- 手测立项页：选中「东方古武玄境」→ 自定义框出现完整小阶链；取消且未编辑 → 该行消失；编辑后再取消 → 保留。
- 选中「精简十境」→ 框内为十境链；与 summary 一致。
- 仅选目录、自定义等于 detailChain → 注入块只有 injectPrompt，无「自定义：」重复。
- 改自定义后再提交 → 注入同时含目录 injectPrompt 与改写后的自定义段。
- 现有无 `detailChain` 条目选中仍不碰自定义框。

## 实现范围文件

- `workbench-server/src/common/novel/novel-setting-catalog-types.ts`
- `workbench-server/src/common/novel/novel-cultivation-catalog.ts`
- `workbench-server/src/common/novel/novel-setting-inject.ts`
- `workbench/app/pages/novel/ideate.vue`
- 可选：若有目录相关冒烟/校验脚本（如 `verify-novel-setting-catalogs-p0.ts`），补断言两条 id 存在且含 `detailChain`。
