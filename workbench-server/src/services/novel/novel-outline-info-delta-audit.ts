/**
 * 大纲【信息增量】模型审 — 题材无关语义判定。
 * 字面匹配（outlineInfoDeltaCovered）仅作候选/补写提示；终审与硬拒以本模块为准。
 */
import { chatCompletionTextAudit, type TextBillingContext } from '../ai/ai.js'
import { logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn } from '../../common/task/task-logger.js'
import type { OutlineComplianceReason } from './novel-outline-compliance.js'
import {
  extractOutlineInfoDelta,
  splitInfoDeltaPointsForCover,
} from './novel-outline-beat-cover.js'

/**
 * 设定介绍类要点的语义合同（题材无关）：
 * 由模型按要点含义判断，禁止用词表/题材关键词门控。
 */
export const INFO_DELTA_SETTING_INTRO_RULE =
  '若某要点的语义是「介绍/交代一套设定」，covered 的标准是：正文已让读者理解该设定自身的结构（如何分档、有何规则或范围）。仅出现属于该设定范畴的个别标签、称呼或角色当前状态，不等于介绍该设定。'

const SYSTEM = `你是网文章节【信息增量】落地审校（题材无关）。

## 任务
对照【信息增量要点】逐条判断正文是否已场面化落地。只依据语义与情节事实，不要求字面套话，不依赖题材词表。

## covered（已落地）
- 正文以叙述/对白/心理/规则一句写出该要点的核心事实或结果
- 结果态要点：写的是「已发生/已完成」的语义即可（如「…成了」「初成」「已落到实处」「当场揭穿」），**不要求**出现「完成了」「兑现了」等固定词
- ${INFO_DELTA_SETTING_INTRO_RULE}

## missing（未落地）
- 要点核心事实在正文中不存在，或仅停留在打算/未发生/还没/尚未/改日再办
- 只用旧态冒充结果态（如「还欠着」冒充「已结清」）
- 要点要「介绍设定」，正文却只有个体标签/状态称呼、未交代设定结构 → **missing**

## partial
- 有痕迹但不完整；本审校按 **missing** 处理（须补写），勿输出 partial

## 不要做
- 不要因文风、口语、字数、节奏判 missing
- 不要要求正文复述大纲原句
- 不要用题材关键词清单代替语义判断
- 不要引入要点之外的书情硬伤
- 禁止 ok=true 却仍有 missing 条；禁止 ok=false 却 items 全 covered

只输出一个 JSON 对象：
{"ok":true|false,"reason":"总因一句","items":[{"point":"与要点原文一致或可对应","status":"covered"|"missing","reason":"一句","excerpt":"covered时可摘原文8字以上；missing可空"}]}
`

function trunc(s: string, n: number): string {
  const t = s.trim()
  if ([...t].length <= n) return t
  return `${[...t].slice(0, n).join('')}…`
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const text = (fenced?.[1] ?? trimmed).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

export type InfoDeltaAuditItem = {
  point: string
  status: 'covered' | 'missing'
  reason: string
  excerpt?: string
}

export type InfoDeltaAuditResult = {
  /** covered=模型认定落地；missing=须拦；unavailable=调用/解析失败（降级不硬拒） */
  status: 'covered' | 'missing' | 'unavailable'
  ok: boolean
  reason: string
  items: InfoDeltaAuditItem[]
  /** 若 missing，可直接并入大纲合规 reasons */
  reasons: OutlineComplianceReason[]
}

export type InfoDeltaAuditArgs = {
  content: string
  chapterOutline?: string
  /** 字面检出的疑似缺失（可选，供模型聚焦） */
  lexicalMissing?: string[]
  chapterNumber: number
  billing?: TextBillingContext
}

export function buildInfoDeltaAuditUserPartsForTest(
  args: Omit<InfoDeltaAuditArgs, 'billing'>,
): string[] {
  const delta = extractOutlineInfoDelta(args.chapterOutline)
  const points = splitInfoDeltaPointsForCover(delta)
  return [
    `【审校章节】第 ${args.chapterNumber} 章`,
    points.length
      ? `【信息增量要点·须逐条判定】\n${points.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : `【信息增量原文】\n${trunc(delta, 800)}`,
    args.lexicalMissing?.length
      ? `【字面预筛·疑似未落地（仅供参考，以语义为准）】\n${args.lexicalMissing.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : '',
    args.content?.trim()
      ? `【待审正文】\n${trunc(args.content, 10000)}`
      : '',
  ].filter(Boolean)
}

/** 将模型 JSON 映射为审校结果（供 verify / 主路径共用） */
export function mapInfoDeltaModelVerdict(
  parsed: unknown,
  expectedPoints: string[],
): InfoDeltaAuditResult {
  const obj = parsed as {
    ok?: boolean
    reason?: string
    items?: Array<{ point?: string; status?: string; reason?: string; excerpt?: string }>
  } | null

  if (!obj || typeof obj !== 'object') {
    return {
      status: 'unavailable',
      ok: false,
      reason: '信息增量模型审结果不可解析',
      items: [],
      reasons: [],
    }
  }

  const items: InfoDeltaAuditItem[] = []
  const rawItems = Array.isArray(obj.items) ? obj.items : []
  for (const it of rawItems.slice(0, 8)) {
    const point = typeof it.point === 'string' ? it.point.trim() : ''
    const st = typeof it.status === 'string' ? it.status.trim().toLowerCase() : ''
    const reason = typeof it.reason === 'string' ? it.reason.trim() : ''
    const excerpt = typeof it.excerpt === 'string' ? it.excerpt.trim() : ''
    if (!point && !reason) continue
    const status: 'covered' | 'missing' =
      st === 'covered' || st === 'ok' || st === 'pass' ? 'covered' : 'missing'
    items.push({
      point: point || reason.slice(0, 40),
      status,
      reason: reason || (status === 'covered' ? '已落地' : '未落地'),
      ...(excerpt ? { excerpt: excerpt.slice(0, 80) } : {}),
    })
  }

  // 模型漏交某条：若 expected 有而 items 无对应，按 missing 补（避免空 items + ok=true 洗白）
  if (expectedPoints.length && items.length) {
    for (const ep of expectedPoints) {
      const hit = items.some(it =>
        it.point.includes(ep.slice(0, 12)) || ep.includes(it.point.slice(0, 12)),
      )
      if (!hit) {
        items.push({
          point: ep,
          status: 'missing',
          reason: '模型未对该要点出具判定，按未落地处理',
        })
      }
    }
  }

  const missing = items.filter(i => i.status === 'missing')
  const claimedOk = obj.ok === true
  const reasonText = typeof obj.reason === 'string' ? obj.reason.trim() : ''

  // 声称通过但有 missing / 无 items 却 expected 非空 → 不通过
  if (claimedOk && missing.length === 0 && (items.length > 0 || expectedPoints.length === 0)) {
    return {
      status: 'covered',
      ok: true,
      reason: reasonText || '信息增量语义已落地',
      items,
      reasons: [],
    }
  }

  if (claimedOk && items.length === 0 && expectedPoints.length > 0) {
    return {
      status: 'unavailable',
      ok: false,
      reason: '模型声称通过但未交 items',
      items: [],
      reasons: [],
    }
  }

  const missPts = missing.map(m => m.point).filter(Boolean)
  const detail = missPts.slice(0, 4).join(' | ')
  const message =
    `本章未兑现大纲【信息增量】（语义审）。`
    + (missPts.length ? `缺失：${missPts.join('；')}` : (reasonText || '要点未场面化落地'))

  return {
    status: 'missing',
    ok: false,
    reason: reasonText || message,
    items,
    reasons: [{
      code: 'info_delta_missing',
      message,
      detail: detail || reasonText.slice(0, 120) || undefined,
    }],
  }
}

/**
 * 语义审【信息增量】。
 * - covered：去掉字面 info_delta_missing
 * - missing：以模型 reasons 为准
 * - unavailable：调用失败 → 调用方应降级不硬拒
 */
export async function auditInfoDeltaWithModel(
  args: InfoDeltaAuditArgs,
): Promise<InfoDeltaAuditResult> {
  const outline = args.chapterOutline?.trim() || ''
  const content = args.content?.trim() || ''
  const delta = extractOutlineInfoDelta(outline)
  const points = splitInfoDeltaPointsForCover(delta)

  if ([...delta].length < 4 || [...content].length < 80) {
    return {
      status: 'covered',
      ok: true,
      reason: '无有效信息增量或正文过短，跳过模型审',
      items: [],
      reasons: [],
    }
  }

  logTaskStart('Novel', 'info-delta-model-audit', {
    chapterNumber: args.chapterNumber,
    points: points.length,
    lexicalMissing: args.lexicalMissing?.length ?? 0,
  })

  try {
    const user = buildInfoDeltaAuditUserPartsForTest(args).join('\n\n')
    const raw = await chatCompletionTextAudit(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      {
        maxTokens: 4096,
        temperature: 0.15,
        billing: args.billing
          ? { ...args.billing, reason: '小说信息增量语义审' }
          : undefined,
      },
    )
    const parsed = extractJsonObject(raw)
    const result = mapInfoDeltaModelVerdict(parsed, points)
    if (result.status === 'covered') {
      logTaskSuccess('Novel', 'info-delta-model-audit', {
        chapterNumber: args.chapterNumber,
        covered: result.items.filter(i => i.status === 'covered').length,
        reason: result.reason.slice(0, 80),
      })
    } else if (result.status === 'missing') {
      logTaskWarn('Novel', 'info-delta-model-audit', {
        chapterNumber: args.chapterNumber,
        missing: result.items.filter(i => i.status === 'missing').length,
        detail: result.reasons[0]?.detail?.slice(0, 120),
      })
    } else {
      logTaskWarn('Novel', 'info-delta-model-audit-unavailable', {
        chapterNumber: args.chapterNumber,
        reason: result.reason.slice(0, 120),
      })
    }
    return result
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logTaskWarn('Novel', 'info-delta-model-audit-failed', {
      chapterNumber: args.chapterNumber,
      error: msg.slice(0, 200),
    })
    return {
      status: 'unavailable',
      ok: false,
      reason: msg,
      items: [],
      reasons: [],
    }
  }
}

/** 合并：用语义审覆盖本地 info_delta_missing */
export function applyInfoDeltaModelToReasons(
  localReasons: OutlineComplianceReason[],
  audit: InfoDeltaAuditResult,
): { reasons: OutlineComplianceReason[]; softPassedInfoDelta: boolean } {
  const without = localReasons.filter(r => r.code !== 'info_delta_missing')
  if (audit.status === 'covered') {
    return { reasons: without, softPassedInfoDelta: true }
  }
  if (audit.status === 'unavailable') {
    logTaskProgress('Novel', 'info-delta-model-soft-pass', {
      reason: audit.reason.slice(0, 120),
    })
    return { reasons: without, softPassedInfoDelta: true }
  }
  // missing：以模型 reasons 替换字面条
  return {
    reasons: [...without, ...audit.reasons],
    softPassedInfoDelta: false,
  }
}

export function getInfoDeltaAuditSystemPromptForTest(): string {
  return SYSTEM
}
