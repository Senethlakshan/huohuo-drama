# Novel Cultivation Two Systems Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two cultivation catalog entries with `detailChain`, sync the ideate custom box on select/hot-apply, and dedupe mirror custom text on inject.

**Architecture:** Extend `NovelSettingCatalogEntry` with optional `detailChain`; SSOT entries in `novel-cultivation-catalog.ts`; filter mirror lines in `resolveCultivationBlock`; share select/deselect helpers in `ideate.vue` (markDirty stays on `toggleCultivation` only).

**Tech Stack:** TypeScript, Nuxt/Vue ideate page, existing `verify-novel-setting-catalogs-p0.ts` script.

**Spec:** `docs/superpowers/specs/2026-10-18-novel-cultivation-two-systems-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `novel-setting-catalog-types.ts` | Add optional `detailChain?: string` |
| `novel-cultivation-catalog.ts` | Two new active entries with exact injectPrompt/detailChain |
| `novel-setting-inject.ts` | Strip custom lines that equal selected detailChains |
| `ideate.vue` | select/deselect + toggle + applyHotItem sync |
| `verify-novel-setting-catalogs-p0.ts` | Assert ids, detailChain, mirror inject |

---

## Chunk 1: Catalog + inject + verify

### Task 1: Type + catalog entries

**Files:**
- Modify: `workbench-server/src/common/novel/novel-setting-catalog-types.ts`
- Modify: `workbench-server/src/common/novel/novel-cultivation-catalog.ts` (after `cu_body_temper`)

- [ ] **Step 1: Add `detailChain?: string` to `NovelSettingCatalogEntry`**

- [ ] **Step 2: Insert two catalog entries** with exact strings from spec:
  - `cu_eastern_xuanwu` / 东方古武玄境
  - `cu_lean_realm_ten` / 精简十境

- [ ] **Step 3: Commit**

```bash
git add workbench-server/src/common/novel/novel-setting-catalog-types.ts workbench-server/src/common/novel/novel-cultivation-catalog.ts
git commit -m "Add eastern xuanwu and lean ten-realm cultivation catalogs."
```

### Task 2: Inject mirror dedupe + verify script

**Files:**
- Modify: `workbench-server/src/common/novel/novel-setting-inject.ts`
- Modify: `workbench-server/scripts/verify-novel-setting-catalogs-p0.ts`

- [ ] **Step 1: In `resolveCultivationBlock`, filter custom lines**

Logic:
1. Collect trim non-empty `detailChain` from selected catalog entries.
2. Split custom: `(custom || '').replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean)`.
3. Drop lines equal to any selected detailChain.
4. Remaining empty → treat as no custom (catalog-only branches: single → raw injectPrompt; multi → parallel bullets without 自定义).
5. Remaining non-empty → join with `\n`, keep existing multi/custom append behavior.

- [ ] **Step 2: Extend verify script**

Assert:
- Both ids exist in active catalog with non-empty `detailChain`.
- `buildNovelSettingInjectBlock` with `cultivation_ids: ['cu_eastern_xuanwu']` and `cultivation_custom` = that entry's `detailChain` includes 「东方古武」or inject keyword, and does **not** include `自定义：`.
- Same pattern for `cu_lean_realm_ten` / 「精简十境」.

- [ ] **Step 3: Run verify**

```bash
cd workbench-server
npx tsx scripts/verify-novel-setting-catalogs-p0.ts
```

Expected: `verify-novel-setting-catalogs-p0 ok`

- [ ] **Step 4: Commit**

```bash
git add workbench-server/src/common/novel/novel-setting-inject.ts workbench-server/scripts/verify-novel-setting-catalogs-p0.ts
git commit -m "Dedupe cultivation detailChain mirrors on setting inject."
```

---

## Chunk 2: Ideate UI sync

### Task 3: Cultivation select helpers + hot apply

**Files:**
- Modify: `workbench/app/pages/novel/ideate.vue` (around `toggleCultivation` / `applyHotItem`)

- [ ] **Step 1: Add helpers** (same file; do **not** call `markDirty` inside select/deselect):

```js
function splitCultivationCustomLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

function joinCultivationCustomLines(lines) {
  return lines.join('\n')
}

function syncCultivationDetailChain(id, mode) {
  const entry = listCultivations().find(e => e.id === id)
  const chain = (entry?.detailChain || '').trim()
  if (!chain) return
  const lines = splitCultivationCustomLines(cultivationCustom.value)
  if (mode === 'add') {
    if (!lines.includes(chain)) lines.push(chain)
  } else {
    const next = lines.filter(l => l !== chain)
    cultivationCustom.value = joinCultivationCustomLines(next)
    return
  }
  cultivationCustom.value = joinCultivationCustomLines(lines)
}

function selectCultivationId(id) {
  const cur = [...cultivationIds.value]
  if (cur.includes(id)) return true
  if (cur.length >= CULTIVATION_PICK_MAX) {
    toast.info(tm.value.ideate.cultivationMaxHint)
    return false
  }
  cur.push(id)
  cultivationIds.value = cur
  syncCultivationDetailChain(id, 'add')
  return true
}

function deselectCultivationId(id) {
  cultivationIds.value = cultivationIds.value.filter(x => x !== id)
  syncCultivationDetailChain(id, 'remove')
}

function toggleCultivation(id) {
  markDirty('cultivation')
  if (cultivationIds.value.includes(id)) deselectCultivationId(id)
  else selectCultivationId(id)
}
```

- [ ] **Step 2: Update `applyHotItem`** cultivation branch to:

```js
if (mapped.cultivationId && !isDirty('cultivation')) {
  if (listCultivations().some(e => e.id === mapped.cultivationId)) {
    if (!cultivationIds.value.includes(mapped.cultivationId)) {
      selectCultivationId(mapped.cultivationId)
    }
  }
}
```

Note: at-max may toast (vs old silent slice) — accepted per spec review advisory.

- [ ] **Step 3: Commit**

```bash
git add workbench/app/pages/novel/ideate.vue
git commit -m "Sync cultivation detailChain into ideate custom box."
```

---

## Done when

- Two new cards appear on novel ideate cultivation grid.
- Selecting them fills custom textarea; deselect without edit clears the line.
- Inject with custom=detailChain does not duplicate as 自定义.
- `npx tsx scripts/verify-novel-setting-catalogs-p0.ts` passes.
