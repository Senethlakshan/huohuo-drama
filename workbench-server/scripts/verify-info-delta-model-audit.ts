/**
 * 信息增量语义审：映射层（不调 LLM）
 * npx tsx scripts/verify-info-delta-model-audit.ts
 */
import {
  applyInfoDeltaModelToReasons,
  INFO_DELTA_SETTING_INTRO_RULE,
  mapInfoDeltaModelVerdict,
} from '../src/services/novel/novel-outline-info-delta-audit.js'
import type { OutlineComplianceReason } from '../src/services/novel/novel-outline-compliance.js'

// 合同须是语义结构，禁止题材词表门控
if (!/介绍\/交代一套设定/.test(INFO_DELTA_SETTING_INTRO_RULE)) {
  throw new Error('setting-intro rule must be semantic (introduce a setting)')
}
if (!/个别标签|当前状态/.test(INFO_DELTA_SETTING_INTRO_RULE)) {
  throw new Error('setting-intro rule must reject label-only as intro')
}
for (const banned of ['凡血', '灵血', '王血', '修炼境界', '血脉境界', '秦昭']) {
  if (INFO_DELTA_SETTING_INTRO_RULE.includes(banned)) {
    throw new Error(`setting-intro rule must not anchor novel/genre terms: ${banned}`)
  }
}

// 通用占位要点（非某书专名）
const points = [
  '主角完成第一次跃升：旧档转新档，兑现金手指第一阶',
  '随身空间容量随跃升略有扩大，取物代价减轻一分',
  '关键道具在隐藏通道首次被感知',
  '简单介绍力量分档设定',
]

// 叙事完成态：模型判 covered → 去掉字面 missing
const coveredJson = {
  ok: true,
  reason: '跃升与设定均已场面化',
  items: points.map(point => ({
    point,
    status: 'covered' as const,
    reason: '已落地',
    excerpt: '旧档转新档，成了',
  })),
}
const covered = mapInfoDeltaModelVerdict(coveredJson, points)
if (covered.status !== 'covered' || covered.reasons.length) {
  throw new Error(`叙事完成态须 covered，got ${JSON.stringify(covered)}`)
}

const localMiss: OutlineComplianceReason[] = [{
  code: 'info_delta_missing',
  message: '本章未兑现大纲【信息增量】（字面）。缺失：旧档转新档',
  detail: points[0],
}, {
  code: 'brief_pacing',
  message: '节奏软告警',
}]
const appliedCovered = applyInfoDeltaModelToReasons(localMiss, covered)
if (appliedCovered.reasons.some(r => r.code === 'info_delta_missing')) {
  throw new Error('语义 covered 后不得保留 info_delta_missing')
}
if (!appliedCovered.reasons.some(r => r.code === 'brief_pacing')) {
  throw new Error('须保留其它合规原因')
}
if (!appliedCovered.softPassedInfoDelta) {
  throw new Error('covered 须 softPassedInfoDelta')
}

// 旧态：模型判 missing
const missingJson = {
  ok: false,
  reason: '税银仍为未结清旧态',
  items: [
    { point: '补上了三年的欠税', status: 'missing', reason: '正文仍写还欠' },
  ],
}
const missing = mapInfoDeltaModelVerdict(missingJson, ['补上了三年的欠税'])
if (missing.status !== 'missing' || !missing.reasons.some(r => r.code === 'info_delta_missing')) {
  throw new Error(`旧态须 missing，got ${JSON.stringify(missing)}`)
}
const appliedMiss = applyInfoDeltaModelToReasons(localMiss, missing)
if (!appliedMiss.reasons.some(r => r.code === 'info_delta_missing')) {
  throw new Error('语义 missing 须保留 info_delta_missing')
}
if (appliedMiss.softPassedInfoDelta) {
  throw new Error('missing 不得 soft pass')
}

// 调用失败：降级不硬拒
const unavailable = mapInfoDeltaModelVerdict(null, points)
if (unavailable.status !== 'unavailable') {
  throw new Error(`null 解析须 unavailable，got ${unavailable.status}`)
}
const appliedUnavail = applyInfoDeltaModelToReasons(localMiss, unavailable)
if (appliedUnavail.reasons.some(r => r.code === 'info_delta_missing')) {
  throw new Error('unavailable 须去掉 info_delta_missing（不硬拒）')
}
if (!appliedUnavail.softPassedInfoDelta) {
  throw new Error('unavailable 须 softPassedInfoDelta')
}

// 声称 ok 但无 items → unavailable
const emptyOk = mapInfoDeltaModelVerdict({ ok: true, reason: '过', items: [] }, points)
if (emptyOk.status !== 'unavailable') {
  throw new Error(`空 items + ok 须 unavailable，got ${emptyOk.status}`)
}

console.log('verify-info-delta-model-audit OK')
