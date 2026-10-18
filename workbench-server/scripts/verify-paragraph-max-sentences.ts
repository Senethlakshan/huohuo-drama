/**
 * 每段最多 3 句
 * npx tsx scripts/verify-paragraph-max-sentences.ts
 */
import {
  assertNovelProseLayoutContract,
  enforceMaxSentencesPerParagraph,
  enforceNovelProseDeliveryLayout,
} from '../src/common/novel/novel-paragraph-format.js'

const wall = '他拿雪搓干净了手，把卷在袖口里的肠子取出来搁在木盆里，解开抖了抖，里头还没冻实，得赶紧收拾。这东西在外头零下二十多度的地界放久了会发苦，吃着扎嘴。蹲在灶台边那块豁了边的木板前，左手把肠子捏住，右手拿那把从鹿皮套里抽出来的猎刀，刀尖轻轻一划，肠衣里那层脏水就流出来了。拿雪搓了几遍，又翻过来把里头那层黏膜刮净。这活儿费工夫，他动作不急，刀贴着肠壁一层层刮过去，外头那层薄皮不破才算利索。刮完了用雪再搓两遍，卷起来搁在干净的雪堆里冻着，回头炖汤时切段丢进去，提鲜。'

const out = enforceMaxSentencesPerParagraph(wall)
const paras = out.split(/\n\n+/).filter(Boolean)
// 6 句 → 宜 2 段×3 句（场面 1～6 段均可，不强制 3 段）
if (paras.length < 1 || paras.length > 6) {
  throw new Error(`场面段数宜在 1～6，实际 ${paras.length}`)
}
for (const p of paras) {
  const n = (p.match(/[。！？!?]/g) || []).length
  if (n > 3) throw new Error(`段超 3 句(${n}): ${p.slice(0, 40)}…`)
}
if (paras.length === 2 && paras.every(p => (p.match(/[。！？!?]/g) || []).length === 3)) {
  // ideal for this 6-sentence fixture
} else if (paras.some(p => (p.match(/[。！？!?]/g) || []).length > 3)) {
  throw new Error('单段不得超过 3 句')
}

// 4 短句一段（模型内心短拍连写，真实写法）：硬切为前 3 + 末 1
const shortChain =
  '秦默把这点嚼了两遍。图在匣里。匣子在驿馆西厢夹墙。明日再议，说明今晚那匣子不会挪窝。'
const shortOut = enforceMaxSentencesPerParagraph(shortChain)
const shortParas = shortOut.split(/\n\n+/).filter(Boolean)
if (shortParas.length !== 2) {
  throw new Error(`4 句应拆成 2 段，实际 ${shortParas.length}: ${JSON.stringify(shortOut)}`)
}
if ((shortParas[0]!.match(/[。！？!?]/g) || []).length !== 3) {
  throw new Error(`首段应 3 句: ${shortParas[0]}`)
}
if ((shortParas[1]!.match(/[。！？!?]/g) || []).length !== 1) {
  throw new Error(`末段应 1 句: ${shortParas[1]}`)
}
const shortGate = assertNovelProseLayoutContract(enforceNovelProseDeliveryLayout(shortChain))
if (!shortGate.ok) {
  throw new Error(`短句链交付合同失败: ${shortGate.reasons.join('; ')}`)
}

console.log('verify-paragraph-max-sentences OK', {
  paragraphs: paras.length,
  sentences: paras.map(p => (p.match(/[。！？!?]/g) || []).length),
  shortChainOk: true,
})
