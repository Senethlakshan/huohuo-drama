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
4. 热门榜一键套用（`applyHotItem`）若写入带 `detailChain` 的修炼 id，同样同步自定义框。

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

## 行拆分规则（前端与注入共用语义）

对 `cultivationCustom` / `cultivation_custom` 做按行处理时：

1. 先将 `\r\n` 规范为 `\n`，再按 `\n` 拆分。
2. 每行 `trim()`；空行丢弃。
3. 行相等比较：双方 trim 后字符串全等。
4. 写回时用 `\n` 连接保留行（不保留行尾空格）。

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

**injectPrompt（最终字符串，实现时原样写入）：**

```
修炼体系用东方古武玄境（偏肉身+神魂，适合低魔/高武；用「-」连接大境界）：凡境-灵境-玄境-地境-天境-圣境-帝境-道境。各大境内部小阶：凡境（锻皮-锻肉-锻骨-锻髓，凡人极限）；灵境（醒灵-聚灵-凝灵）；玄境（玄士-玄师-玄将-玄王）；地境（地宗-地皇-地尊）；天境（天君-天王-天帝）；圣境（半圣-圣人-圣王）；帝境（大帝-天帝-帝尊）；道境（道祖-道尊）。帝境「天帝」与天境「天帝」须按所属大境区分，禁止混称导致跳境。各大境内可分初期/中期/后期/巅峰/圆满，可加「半步XX」过渡。大境界之间存在天堑、跨阶极难；同境小阶可依功法、法宝、秘术越级。可选附加：灵根、道基、心魔、天劫、本源法则。全书只准这一套名称，禁止无铺垫跳境。
```

### 2. `cu_lean_realm_ten` — 精简十境

| 字段 | 值 |
|------|-----|
| label | 精简十境 |
| summary | `锻身-聚元-凝府-化灵-王境-皇境-尊境-圣境-帝境-超脱` |
| detailChain | `锻身-聚元-凝府-化灵-王境-皇境-尊境-圣境-帝境-超脱` |
| genreSkillKeys | `[]` |
| status | `active` |

**injectPrompt（最终字符串，实现时原样写入）：**

```
修炼体系用精简十境（适合短篇、快节奏网文；用「-」连接）：锻身-聚元-凝府-化灵-王境-皇境-尊境-圣境-帝境-超脱（依次为锤炼躯体、凝聚元气、丹田成府、诞生灵识、称王一方、皇道加身、一域至尊、成圣、证帝、跳出世界束缚）。各大境分初期/中期/后期/巅峰/圆满，可加「半步XX」过渡。大境界之间存在天堑、跨阶极难；同境小阶可依功法、法宝、秘术越级。可选附加：灵根、道基、心魔、天劫、本源法则。全书只准这一套名称，禁止无铺垫跳境。
```

## 前端联动（`ideate.vue`）

抽出共享辅助（同文件内即可，无需新模块）：

- `splitCultivationCustomLines(text): string[]` — 按上文行拆分规则。
- `joinCultivationCustomLines(lines: string[]): string` — `\n` 连接。
- `syncCultivationDetailChain(id, mode: 'add' | 'remove')` — 按条目 `detailChain` 追加或精确移除一行。
- `selectCultivationId(id): boolean` — 未超上限则加入 `cultivationIds` 并 `syncCultivationDetailChain(id, 'add')`，返回是否成功；超限 toast 与现网一致，返回 false。
- `deselectCultivationId(id)` — 从 `cultivationIds` 移除并 `syncCultivationDetailChain(id, 'remove')`。

### `toggleCultivation(id)`

- 已选中 → `deselectCultivationId(id)`。
- 未选中 → `selectCultivationId(id)`。

### `applyHotItem` 路径（必做）

当 `mapped.cultivationId` 有效且 `!isDirty('cultivation')`、目录中存在该 id 时：

- **不要**再直接 `cultivationIds.value = [...].slice(...)`。
- 若尚未包含该 id，调用 `selectCultivationId(mapped.cultivationId)`（内部已处理上限与 `detailChain` 填充）。
- 若已包含该 id，不重复追加 ids，也不重复追加 `detailChain` 行。

### 选中时 `detailChain` 行为

1. 条目无非空 `detailChain` → 不改 `cultivationCustom`。
2. 有 `detailChain`：若按行拆分后已存在相同行 → 不重复追加；否则追加一行。

### 取消选中时

1. 有 `detailChain`：删除与该 `detailChain` trim 后全等的行。
2. 用户已改写该行 → 不删除。

### 「自定义」卡片

`focusCustom('cultivation')` 行为不变。

## 注入去重（`novel-setting-inject.ts` · `resolveCultivationBlock`）

在现有「目录条目 + 自定义」拼装逻辑上增加镜像过滤：

1. 收集已选条目的全部非空 `detailChain`（trim）。
2. 将 `cultivation_custom` 按上文行拆分规则拆成行。
3. 过滤掉与任一已选 `detailChain` 全等的行（展示镜像）。
4. 无剩余自定义行 → 不追加「自定义：…」段；仅输出目录 `injectPrompt`。
5. 有剩余自定义行 → `\n` 拼回后按现网规则追加。

不改变：单目录无自定义、仅自定义无目录、多目录并行等既有分支语义。

## 单元边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `novel-setting-catalog-types` | 类型含可选 `detailChain` | 无 |
| `novel-cultivation-catalog` | 两条新条目 + 最终 injectPrompt / detailChain | types |
| `ideate.vue` 共享 select/deselect | 卡片切换与热门套用共用 | catalog via listCultivations |
| `novel-setting-inject` | 自定义镜像行去重 | catalog + meta |
| `verify-novel-setting-catalogs-p0.ts` | 断言两条 id、detailChain、镜像注入无「自定义：」重复 | catalog + inject |

## 错误与边界

- 多选达上限：不选中、不写自定义框。
- 同一 `detailChain` 已在自定义框中：不重复追加。
- 用户编辑后取消选中：保留编辑后的行。
- 两处「天帝」：injectPrompt 用大境归属消歧；detailChain 保留两处「天帝」。
- Windows 换行：统一按 `\r\n`→`\n` 再拆行。

## 验证

- 手测：选中「东方古武玄境」→ 自定义框出现完整小阶链；取消且未编辑 → 该行消失；编辑后再取消 → 保留。
- 手测：选中「精简十境」→ 框内为十境链。
- 手测：热门套用若映射到带 `detailChain` 的 id 且 cultivation 未 dirty → 自定义框同步填充。
- 脚本：`verify-novel-setting-catalogs-p0.ts` 断言两 id 存在、`detailChain` 非空；单选 + custom=detailChain 时注入无「自定义：」字样且含 injectPrompt 关键字。
- 现有无 `detailChain` 条目选中仍不碰自定义框。

## 实现范围文件（封闭）

- `workbench-server/src/common/novel/novel-setting-catalog-types.ts`
- `workbench-server/src/common/novel/novel-cultivation-catalog.ts`
- `workbench-server/src/common/novel/novel-setting-inject.ts`
- `workbench/app/pages/novel/ideate.vue`
- `workbench-server/scripts/verify-novel-setting-catalogs-p0.ts`
