/**
 * 全书大纲【主要人物】稳定属性（性别/代词/年龄等）
 * - 性别·代词：生成侧**常驻**注入（有则注入）；审核侧硬检跨章代词翻转
 * - 年龄：生成侧**按需**注入（本章涉及年龄/登记等才注入）；审核侧对照大纲硬检
 */

export type StableCastFact = {
  name: string
  ageYears?: number
  /** 原文年龄片段，如「19岁」「十九岁」 */
  ageRaw?: string
  /** 男 / 女 / 其它（大纲原文归一） */
  gender?: 'male' | 'female' | 'other'
  /** 叙述代词：他 / 她 / 它 */
  pronoun?: '他' | '她' | '它'
  blurb?: string
}

export type StableAgeConflict = {
  layer: 'hard'
  rule: 'stable_age_conflict'
  message: string
}

export type StableGenderConflict = {
  layer: 'hard'
  rule: 'stable_gender_conflict'
  message: string
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
}

/** 解析「19」「十九」「二十三」→ 数字岁 */
export function parseAgeToken(raw: string): number | null {
  const s = (raw || '').trim()
  if (!s) return null
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s)
    return n >= 1 && n <= 120 ? n : null
  }
  if (s === '十') return 10
  if (s.startsWith('十') && s.length <= 2) {
    const ones = CN_DIGIT[s[1]!]
    return ones != null ? 10 + ones : null
  }
  if (s.endsWith('十') && s.length === 2) {
    const tens = CN_DIGIT[s[0]!]
    return tens != null ? tens * 10 : null
  }
  if (s.includes('十') && s.length === 3) {
    const [a, , b] = s
    const tens = CN_DIGIT[a!]
    const ones = CN_DIGIT[b!]
    if (tens != null && ones != null) return tens * 10 + ones
  }
  if (s.length === 1 && CN_DIGIT[s] != null) return CN_DIGIT[s]!
  return null
}

function extractCastSection(outline: string): string {
  const t = outline || ''
  const headers = [
    /【\s*主要人物\s*】/,
    /【\s*人物核心\s*】/,
    /(?:^|\n)\s*#{1,3}\s*主要人物\s*\n/i,
    /(?:^|\n)\s*[-*•]?\s*\*{0,2}主要人物\*{0,2}\s*[:：]?\s*\n/,
  ]
  let start = -1
  for (const re of headers) {
    const m = t.match(re)
    if (m && m.index != null) {
      start = m.index + m[0].length
      break
    }
  }
  if (start < 0) {
    // 行内：- **姓名**：…19岁
    return t
  }
  const rest = t.slice(start)
  const end = rest.search(/\n【|\n#{1,3}\s*分卷|\n#{1,3}\s*分章|\n【分卷|\n【分章/)
  return end >= 0 ? rest.slice(0, end) : rest.slice(0, 4000)
}

/** 从称谓行解析性别与代词（题材无关） */
export function parseGenderPronounFromBlurb(blurb: string): {
  gender?: StableCastFact['gender']
  pronoun?: StableCastFact['pronoun']
} {
  const raw = (blurb || '').trim()
  if (!raw) return {}
  const parts = raw.split(/[|｜]/).map(s => s.trim()).filter(Boolean)
  let gender: StableCastFact['gender'] | undefined
  let pronoun: StableCastFact['pronoun'] | undefined

  for (const p of parts) {
    if (/^(他|她|它)$/.test(p)) {
      pronoun = p as StableCastFact['pronoun']
      continue
    }
    if (/^(男|男性|男子)$/.test(p)) {
      gender = 'male'
      continue
    }
    if (/^(女|女性|女子)$/.test(p)) {
      gender = 'female'
      continue
    }
  }

  // 非竖线：句首/逗号后的「男/女」或「男主/女主」
  if (!gender) {
    if (/(?:^|[，,、：:])\s*男(?:性|子|主)?(?:[，,、｜|]|$)/.test(raw) || /^男(?:性|子)?[，,、]/.test(raw)) {
      gender = 'male'
    } else if (/(?:^|[，,、：:])\s*女(?:性|子|主)?(?:[，,、｜|]|$)/.test(raw) || /^女(?:性|子)?[，,、]/.test(raw)) {
      gender = 'female'
    } else if (/男主/.test(raw) && !/女主/.test(raw)) {
      gender = 'male'
    } else if (/女主/.test(raw)) {
      gender = 'female'
    }
  }
  if (!pronoun) {
    if (gender === 'male') pronoun = '他'
    else if (gender === 'female') pronoun = '她'
  }
  return { gender, pronoun }
}

function genderLabel(g: StableCastFact['gender']): string {
  if (g === 'male') return '男'
  if (g === 'female') return '女'
  return '其它'
}

/**
 * 从全书大纲抽取稳定人设（性别/代词/年龄）。
 * 识别：`姓名｜男｜他｜…` / `- **姓名**：女主，19岁…`
 */
export function extractStableCastFactsFromOutline(outline: string): StableCastFact[] {
  const section = extractCastSection(outline)
  const hay = section.trim() ? section : (outline || '')
  if (!hay.trim()) return []
  const facts: StableCastFact[] = []
  const seen = new Set<string>()

  const pushFact = (name: string, blurb: string) => {
    if (name.length < 2 || name.length > 6) return
    if (/^(男主|女主|配角|反派|主要人物|人物核心|性别|代词)$/.test(name)) return
    const ageM = blurb.match(/(\d{1,2}|[一二三四五六七八九十两零〇]{1,3})\s*岁/)
    const ageYears = ageM ? parseAgeToken(ageM[1]!) : null
    const { gender, pronoun } = parseGenderPronounFromBlurb(blurb)
    if (ageYears == null && !gender && !pronoun) return
    if (seen.has(name)) {
      // 合并补全
      const prev = facts.find(f => f.name === name)
      if (prev) {
        if (prev.ageYears == null && ageYears != null) {
          prev.ageYears = ageYears
          prev.ageRaw = ageM?.[0]
        }
        if (!prev.gender && gender) prev.gender = gender
        if (!prev.pronoun && pronoun) prev.pronoun = pronoun
      }
      return
    }
    seen.add(name)
    facts.push({
      name,
      ...(ageYears != null ? { ageYears, ageRaw: ageM![0] } : {}),
      ...(gender ? { gender } : {}),
      ...(pronoun ? { pronoun } : {}),
      blurb: blurb.slice(0, 80),
    })
  }

  const lineRe =
    /(?:^|\n)\s*[-*•]?\s*\*{0,2}([^\s*：:\|｜，,]{2,6})\*{0,2}\s*[：:|｜]\s*([^\n]{2,200})/g
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(hay))) {
    pushFact(m[1]!.replace(/[*【】\[\]]/g, '').trim(), m[2]!.trim())
  }

  // 兜底：全文扫「**姓名**：…」
  if (!facts.length && outline) {
    const boldRe = /\*\*([^*]{2,6})\*\*\s*[：:]\s*([^\n]{2,160})/g
    while ((m = boldRe.exec(outline))) {
      pushFact(m[1]!.trim(), m[2]!.trim())
    }
  }
  return facts
}

export function formatStableCastFactsInjectBlock(facts: StableCastFact[]): string {
  if (!facts.length) return ''
  const lines = facts.map((f) => {
    const bits = [f.name]
    if (f.gender) bits.push(genderLabel(f.gender))
    if (f.pronoun) bits.push(f.pronoun)
    if (f.ageYears != null) bits.push(`${f.ageYears}岁`)
    if (f.blurb) {
      // 去掉与结构化字段重复的「男｜他｜」前缀，避免「男｜他｜男｜他」
      let trimmed = f.blurb.trim()
      for (let i = 0; i < 4; i++) {
        const next = trimmed.replace(/^(?:男|女|男性|女性|他|她|它)(?:｜|,|，)/u, '')
        if (next === trimmed) break
        trimmed = next
      }
      trimmed = trimmed.slice(0, 40)
      if (trimmed && trimmed !== f.name) bits.push(trimmed)
    }
    return `- ${bits.join('｜')}`
  })
  const hasGender = facts.some(f => f.gender || f.pronoun)
  const hasAge = facts.some(f => f.ageYears != null)
  const hardBits = [
    hasGender ? '叙述代词须与上表一致，禁止无交代他↔她翻转' : '',
    hasAge ? '本章若写「几岁/多大/年龄」须与上表一致，禁止无交代改年龄' : '',
  ].filter(Boolean)
  return [
    '【稳定人设·大纲锁定（禁止无交代改性别/代词/年龄）】',
    ...lines,
    hardBits.length ? `硬性：${hardBits.join('；')}。` : '',
  ].filter(Boolean).join('\n')
}

/** 仅性别/代词注入块（常驻；与年龄按需注入可合并） */
export function formatStableGenderInjectBlock(facts: StableCastFact[]): string {
  const withG = facts.filter(f => f.gender || f.pronoun)
  if (!withG.length) return ''
  return formatStableCastFactsInjectBlock(withG)
}

/** 本章大纲/说明判定需要的稳定字段（无需要则不注入） */
export type NeededStableDim = 'age' | 'identity' | 'gender'

/**
 * 根据本章大纲/写作说明动态判断需要注入哪些稳定维。
 * - 点名出场 ≠ 需要年龄（如进山设套）
 * - 核验/盘查/来历类（即使用户未写「几岁」）→ 默认需要年龄+身份（产品选择 A）
 * - 仅「试探/周旋/上门关心」→ 不注入
 */
export function detectNeededStableDimsFromChapterOutline(
  ...signals: Array<string | undefined | null>
): Set<NeededStableDim> {
  const blob = signals.filter(Boolean).join('\n')
  const needed = new Set<NeededStableDim>()
  if (!blob.trim()) return needed

  // 年龄将落笔（显式）
  if (/几岁|多大|年龄|岁数|报年龄|(?:问|查|核|报).{0,8}岁/.test(blob)) {
    needed.add('age')
  }

  // 户籍/身份/来历核验（常连问年龄；含「来历」本身）
  if (/籍贯|户口|登记|档案|履历|成分表|核实身份|身份登记|报上名|身世|来历|成分|查户口|核身份/.test(blob)) {
    needed.add('identity')
    needed.add('age')
  }

  // 盘查/盘问/核验类结构（不必紧贴「户口」字；官方盘查即触发）
  // 排除：单独「试探/周旋/敲打/关心」不够
  if (/官方盘查|盘查|盘问|查问|问话|核验|核查/.test(blob)) {
    needed.add('identity')
    needed.add('age')
  } else if (
    /(?:上门|来访).{0,24}(?:登记|查户口|核身份|问年龄|问几岁|盘查|盘问)/.test(blob)
  ) {
    needed.add('identity')
    needed.add('age')
  }

  return needed
}

/** @deprecated 兼容旧名：是否有任一所需维 */
export function shouldInjectStableCastFacts(...signals: Array<string | undefined | null>): boolean {
  return detectNeededStableDimsFromChapterOutline(...signals).size > 0
}

/**
 * 选取本章应注入的稳定人设：
 * 1) 性别/代词：有则常驻（不依赖本章是否盘查）
 * 2) 年龄/身份：仅当本章大纲判定需要时，附带已写年龄者
 */
export function selectStableCastFactsForInject(
  outline: string,
  ...signals: Array<string | undefined | null>
): StableCastFact[] {
  const facts = extractStableCastFactsFromOutline(outline)
  if (!facts.length) return []
  const needed = detectNeededStableDimsFromChapterOutline(...signals)
  const byName = new Map<string, StableCastFact>()

  for (const f of facts) {
    if (!(f.gender || f.pronoun)) continue
    // 性别常驻：先不带年龄，避免无盘查戏误注入岁数
    byName.set(f.name, {
      name: f.name,
      gender: f.gender,
      pronoun: f.pronoun,
      blurb: f.blurb,
    })
  }
  if (needed.has('age') || needed.has('identity')) {
    for (const f of facts) {
      if (f.ageYears == null) continue
      const prev = byName.get(f.name)
      if (prev) {
        prev.ageYears = f.ageYears
        prev.ageRaw = f.ageRaw
        if (!prev.blurb && f.blurb) prev.blurb = f.blurb
      } else {
        byName.set(f.name, { ...f })
      }
    }
  }
  return [...byName.values()]
}

/** 性别常驻 + 年龄按需；皆无则空串 */
export function maybeFormatStableCastFactsInjectBlock(
  outline: string,
  ...signals: Array<string | undefined | null>
): string {
  return formatStableCastFactsInjectBlock(selectStableCastFactsForInject(outline, ...signals))
}

function compactProse(s: string): string {
  return (s || '').replace(/\s+/g, '')
}

const AGE_Q_RE = /几岁|多大了?|年龄|岁数|报上?年龄/g

/** 对白年龄答句：「二十三。」她答 / 「十九」他答（可无「岁」） */
const AGE_REPLY_SHE_HE_RE = new RegExp(
  `[「『“"'](\\d{1,2}|[一二三四五六七八九十两零〇]{1,3})(?:岁)?[。！!]?[」』”"']\\s*(?:她|他)答`,
  'g',
)

/**
 * 正文年龄与大纲稳定人设冲突 → hard（仅高置信问答结构）
 *
 * **不做**「人名附近出现 N岁」近距硬拦：旁白里弟妹/回忆/年限与人名相邻极常见，近距归因误报率高，不适合 hard。
 * 近距年龄一致性交给模型语义审（软）；硬拦只认：
 * - 显式「几岁/多大」问答后的答句
 * - 「二十三。」她答 / 他答 结构答句
 */
export function detectStableAgeConflicts(
  content: string,
  facts: StableCastFact[],
): StableAgeConflict[] {
  if (!facts.length || !content.trim()) return []
  const hay = compactProse(content)
  const out: StableAgeConflict[] = []
  const ageTok = '(\\d{1,2}|[一二三四五六七八九十两零〇]{1,3})'

  for (const f of facts) {
    if (f.ageYears == null || !hay.includes(f.name)) continue

    // 1) 年龄问答：问句后允许隔写作用（至约 1200 字），答句可无「岁」（「二十三。」她答）
    AGE_Q_RE.lastIndex = 0
    let qm: RegExpExecArray | null
    while ((qm = AGE_Q_RE.exec(hay)) !== null) {
      const qi = qm.index
      const before = hay.slice(Math.max(0, qi - 280), qi)
      const after = hay.slice(qi, qi + 1200)
      const nameNearQ = before.includes(f.name)
      const looseAns = new RegExp(`(${ageTok})(?:岁)?([。！!」』""]|$)`, 'g')
      let am: RegExpExecArray | null
      let caught = false
      while ((am = looseAns.exec(after)) !== null) {
        const tok = am[1]!
        const stated = parseAgeToken(tok)
        if (stated == null) continue
        const ansAt = am.index
        // 她/他答：只认答句近窗人名，避免问句到答句之间其它出场角色被误挂
        const ansCtx = after.slice(Math.max(0, ansAt - 80), ansAt + am[0].length + 12)
        const preAns = after.slice(Math.max(0, ansAt - 160), ansAt)
        const linked =
          nameNearQ
          || ansCtx.includes(f.name)
          || (/(?:她|他)答/.test(ansCtx) && preAns.includes(f.name))
        if (!linked) continue
        const rawBit = am[0]
        const looksLikeAgeReply =
          /岁/.test(rawBit)
          || /[「『""]/.test(after.slice(Math.max(0, ansAt - 2), ansAt + 1))
          || /(?:她|他)答/.test(ansCtx)
          || (/[。！!]/.test(rawBit) && /[「『""]/.test(after.slice(Math.max(0, ansAt - 8), ansAt + 1)))
        if (!looksLikeAgeReply) continue
        if (stated === f.ageYears) continue
        out.push({
          layer: 'hard',
          rule: 'stable_age_conflict',
          message:
            `稳定人设年龄冲突：「${f.name}」大纲为${f.ageYears}岁，回答年龄时说「${tok}」。`
            + `摘录「${(ansCtx.includes(tok) ? ansCtx : `${ansCtx}${tok}`).replace(/\s+/g, '').slice(-36)}」`,
        })
        caught = true
        break
      }
      if (caught) break
    }

    // 2) 无问句仍答年龄：「二十三。」她答 — 前窗须有该人名（结构答句，不依赖几岁词）
    AGE_REPLY_SHE_HE_RE.lastIndex = 0
    let rm: RegExpExecArray | null
    while ((rm = AGE_REPLY_SHE_HE_RE.exec(hay)) !== null) {
      const tok = rm[1]!
      const stated = parseAgeToken(tok)
      if (stated == null || stated === f.ageYears) continue
      const pre = hay.slice(Math.max(0, rm.index - 360), rm.index)
      if (!pre.includes(f.name)) continue
      // 若前窗有多人名，取距答句最近者；非本角色则跳过
      const nearest = nearestCastNameBefore(pre, facts)
      if (nearest && nearest !== f.name) continue
      out.push({
        layer: 'hard',
        rule: 'stable_age_conflict',
        message:
          `稳定人设年龄冲突：「${f.name}」大纲为${f.ageYears}岁，回答年龄时说「${tok}」。`
          + `摘录「${hay.slice(Math.max(0, rm.index - 12), rm.index + rm[0].length).slice(0, 40)}」`,
      })
      break
    }
  }

  // 去重
  const seen = new Set<string>()
  return out.filter((x) => {
    if (seen.has(x.message)) return false
    seen.add(x.message)
    return true
  })
}

/** 答句前窗中距末尾最近的稳定人设名 */
function nearestCastNameBefore(pre: string, facts: StableCastFact[]): string | null {
  let best: { name: string; at: number } | null = null
  for (const f of facts) {
    if (!f.name) continue
    const at = pre.lastIndexOf(f.name)
    if (at < 0) continue
    if (!best || at > best.at) best = { name: f.name, at }
  }
  return best?.name ?? null
}

/**
 * 正文代词与大纲性别锁冲突 → hard
 * 高置信：姓名后短窗内以错误代词作主语（她没/他说/他抬…）
 */
export function detectStableGenderConflicts(
  content: string,
  facts: StableCastFact[],
): StableGenderConflict[] {
  const locked = facts.filter(f => f.pronoun === '他' || f.pronoun === '她')
  if (!locked.length || !content.trim()) return []
  const hay = compactProse(content)
  const out: StableGenderConflict[] = []
  const verb = '没|不|说|看|抬|走|盯|笑|冷|问|答|点|挥|按|拍|踏|站|坐|转身|倒转|负手|伸|递|扔|甩|喝|骂|嗤'

  for (const f of locked) {
    if (!hay.includes(f.name)) continue
    const wrong = f.pronoun === '他' ? '她' : '他'
    const re = new RegExp(`${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.{0,36}${wrong}(?:${verb})`)
    const m = hay.match(re)
    if (!m) continue
    out.push({
      layer: 'hard',
      rule: 'stable_gender_conflict',
      message:
        `稳定人设性别/代词冲突：「${f.name}」大纲代词为「${f.pronoun}」，正文出现「${wrong}」主语翻转。`
        + `摘录「${m[0].slice(0, 36)}」`,
    })
  }

  const seen = new Set<string>()
  return out.filter((x) => {
    if (seen.has(x.message)) return false
    seen.add(x.message)
    return true
  })
}
