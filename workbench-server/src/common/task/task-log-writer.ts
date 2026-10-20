import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format as utilFormat } from 'node:util'
import {
  redactUrl,
  sanitizeForLog,
} from '../security/log-redact.js'

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

const ANSI_RE = /\x1b\[[0-9;]*m/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

type ConsoleOriginals = Record<ConsoleMethod, (...args: unknown[]) => void>

/** installConsoleFileMirror 之后保存的原生 console，供 emit 避免二次落盘 */
let consoleOriginals: ConsoleOriginals | null = null
let consoleMirrorInstalled = false

const tone = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
} as const

/**
 * 服务日志目录（全站：HTTP / 启动 / Novel / AI…）
 * 文件：workbench-server/logs/task-YYYY-MM-DD.log
 */
export const TASK_LOG_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../logs',
)

/** 旧单文件路径（启动时迁移到按日文件） */
export const LEGACY_TASK_LOG_FILE = join(TASK_LOG_DIR, 'task.log')

const TASK_LOG_NAME_RE = /^task-(\d{4}-\d{2}-\d{2})\.log$/

/** 默认保留天数；可用环境变量 TASK_LOG_RETENTION_DAYS 覆盖（最小 1） */
export function resolveTaskLogRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TASK_LOG_RETENTION_DAYS)
  if (Number.isFinite(n) && n >= 1) return Math.min(3650, Math.floor(n))
  return 30
}

function consoleMethodToLevel(method: ConsoleMethod): LogLevel {
  if (method === 'error') return 'ERROR'
  if (method === 'warn') return 'WARN'
  return 'INFO'
}

/** 本地日历日 YYYY-MM-DD（与 toLocale* 一致，避免 UTC 错日） */
export function formatTaskLogDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function taskLogFileForDate(dateStr: string, logDir: string = TASK_LOG_DIR): string {
  return join(logDir, `task-${dateStr}.log`)
}

/**
 * 删除早于保留窗口的 task-YYYY-MM-DD.log。
 * @returns 删除的文件名列表
 */
export function pruneTaskLogsOlderThan(args: {
  logDir?: string
  retentionDays?: number
  today?: string
}): string[] {
  const logDir = args.logDir || TASK_LOG_DIR
  const retentionDays = args.retentionDays ?? resolveTaskLogRetentionDays()
  const today = args.today || formatTaskLogDate()
  if (!existsSync(logDir)) return []

  const cutoff = new Date(`${today}T00:00:00`)
  cutoff.setDate(cutoff.getDate() - (retentionDays - 1))
  const cutoffStr = formatTaskLogDate(cutoff)

  const removed: string[] = []
  for (const name of readdirSync(logDir)) {
    const m = TASK_LOG_NAME_RE.exec(name)
    if (!m) continue
    const fileDate = m[1]!
    if (fileDate < cutoffStr) {
      try {
        unlinkSync(join(logDir, name))
        removed.push(name)
      } catch {
        /* ignore */
      }
    }
  }
  return removed
}

/**
 * 将历史单文件 task.log 迁到 task-YYYY-MM-DD.log（按 mtime 定日）。
 * 目标日已有文件则追加合并后删旧文件。
 */
export function migrateLegacyTaskLog(args?: {
  logDir?: string
  legacyPath?: string
}): { migrated: boolean; target?: string } {
  const logDir = args?.logDir || TASK_LOG_DIR
  const legacyPath = args?.legacyPath || join(logDir, 'task.log')
  if (!existsSync(legacyPath)) return { migrated: false }

  let dateStr = formatTaskLogDate()
  try {
    dateStr = formatTaskLogDate(statSync(legacyPath).mtime)
  } catch {
    /* keep today */
  }
  const target = taskLogFileForDate(dateStr, logDir)
  try {
    mkdirSync(logDir, { recursive: true })
    if (!existsSync(target)) {
      renameSync(legacyPath, target)
    } else {
      const legacy = readFileSync(legacyPath, 'utf8')
      if (legacy.trim()) {
        const existing = readFileSync(target, 'utf8')
        const sep = existing && !existing.endsWith('\n') ? '\n' : ''
        writeFileSync(target, `${existing}${sep}${legacy}`, 'utf8')
      }
      unlinkSync(legacyPath)
    }
    return { migrated: true, target }
  } catch {
    return { migrated: false }
  }
}

export { redactUrl, sanitizeForLog }

export class TaskLogWriter {
  private activeDate = ''
  private activePath = ''
  private dirReady = false
  private legacyMigrated = false
  private readonly logDir: string
  private readonly retentionDays: number

  constructor(opts?: { logDir?: string; retentionDays?: number }) {
    this.logDir = opts?.logDir || TASK_LOG_DIR
    this.retentionDays = opts?.retentionDays ?? resolveTaskLogRetentionDays()
  }

  private levelColor(level: LogLevel): string {
    switch (level) {
      case 'SUCCESS': return tone.green
      case 'WARN': return tone.yellow
      case 'ERROR': return tone.red
      default: return tone.cyan
    }
  }

  /** 控制台仍用短时分秒；落盘带完整日期便于跨日检索 */
  private consoleTimestamp(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }

  private fileTimestamp(d: Date = new Date()): string {
    const date = formatTaskLogDate(d)
    const time = d.toLocaleTimeString('zh-CN', { hour12: false })
    return `${date} ${time}`
  }

  private ensureDayFile(now: Date = new Date()): string {
    const dateStr = formatTaskLogDate(now)
    if (!this.dirReady) {
      mkdirSync(this.logDir, { recursive: true })
      this.dirReady = true
    }
    if (!this.legacyMigrated) {
      this.legacyMigrated = true
      migrateLegacyTaskLog({ logDir: this.logDir })
    }
    if (dateStr !== this.activeDate) {
      this.activeDate = dateStr
      this.activePath = taskLogFileForDate(dateStr, this.logDir)
      pruneTaskLogsOlderThan({
        logDir: this.logDir,
        retentionDays: this.retentionDays,
        today: dateStr,
      })
    }
    return this.activePath
  }

  /** 当前落盘路径（按本地日） */
  currentLogPath(now: Date = new Date()): string {
    return this.ensureDayFile(now)
  }

  private appendFile(line: string) {
    try {
      const path = this.ensureDayFile()
      appendFileSync(path, `${line}\n`, 'utf8')
    } catch {
      /* 文件日志失败不影响主流程 */
    }
  }

  /** console 镜像落盘（去 ANSI）；供 installConsoleFileMirror 使用 */
  appendConsoleLine(text: string, method: ConsoleMethod = 'log') {
    const plain = stripAnsi(text).replace(/\s+$/u, '')
    if (!plain) return
    const level = consoleMethodToLevel(method)
    this.appendFile(`${this.fileTimestamp()} [${level}] ${plain}`)
  }

  private stringifyMeta(meta?: Record<string, unknown>): string {
    if (!meta) return ''
    const safe = sanitizeForLog(meta) as Record<string, unknown>
    const pairs = Object.entries(safe)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${this.stringifyValue(value)}`)
    return pairs.length ? ` | ${pairs.join(' ')}` : ''
  }

  private stringifyValue(value: unknown): unknown {
    if (value == null) return value
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private consoleWrite(method: ConsoleMethod, ...args: unknown[]) {
    const fn = consoleOriginals?.[method] ?? console[method].bind(console)
    fn(...args)
  }

  emit(scope: string, action: string, meta?: Record<string, unknown>, level: LogLevel = 'INFO') {
    const color = this.levelColor(level)
    const consoleTs = this.consoleTimestamp()
    const fileTs = this.fileTimestamp()
    const metaStr = this.stringifyMeta(meta)
    // 走原生 console，避免 console 镜像与结构化行双写
    this.consoleWrite(
      'log',
      `${tone.dim}${consoleTs}${tone.reset} ${color}[${scope}]${tone.reset} ${action}${metaStr}`,
    )
    this.appendFile(`${fileTs} [${level}] [${scope}] ${action}${metaStr}`)
  }

  emitPayload(scope: string, action: string, payload: unknown) {
    const sanitized = this.applyClipping(sanitizeForLog(payload))
    const serialized = typeof sanitized === 'string'
      ? sanitized
      : JSON.stringify(sanitized, null, 2)
    const consoleTs = this.consoleTimestamp()
    const fileTs = this.fileTimestamp()
    this.consoleWrite(
      'log',
      `${tone.dim}${consoleTs}${tone.reset} ${tone.blue}[${scope}]${tone.reset} ${action}\n${serialized}`,
    )
    this.appendFile(`${fileTs} [INFO] [${scope}] ${action} ${serialized.slice(0, 2000)}`)
  }

  private applyClipping(value: unknown): unknown {
    if (value == null) return value
    if (typeof value === 'string') return this.clip(value)
    if (typeof value === 'number' || typeof value === 'boolean') return value

    if (Array.isArray(value)) {
      return value.map(item => this.applyClipping(item))
    }

    if (typeof value === 'object') {
      const output: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const lower = key.toLowerCase()
        if (typeof raw === 'string' && this.shouldClipField(lower, raw)) {
          output[key] = this.clip(raw, 48)
          continue
        }
        output[key] = this.applyClipping(raw)
      }
      return output
    }

    return value
  }

  private shouldClipField(lowerKey: string, raw: string): boolean {
    return lowerKey === 'data'
      || lowerKey === 'b64_json'
      || lowerKey.includes('base64')
      || lowerKey.includes('audiohex')
      || lowerKey.includes('inline')
      || raw.startsWith('data:image/')
  }

  private clip(value: string, edge = 120): string {
    if (value.length <= edge * 2 + 24) return value
    return `${value.slice(0, edge)}...<trimmed ${value.length} chars>...${value.slice(-edge)}`
  }
}

export const defaultTaskLogWriter = new TaskLogWriter()

/**
 * 将 console.log/info/warn/error/debug 镜像到按日日志文件。
 * HTTP 访问日志、启动信息、未走 logTask 的输出都会落盘。
 * 可用 SERVER_LOG_CONSOLE_MIRROR=0 关闭。
 */
export function installConsoleFileMirror(
  writer: TaskLogWriter = defaultTaskLogWriter,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.SERVER_LOG_CONSOLE_MIRROR === '0') return
  if (consoleMirrorInstalled) return
  consoleMirrorInstalled = true

  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug']
  const originals = {} as ConsoleOriginals
  for (const method of methods) {
    originals[method] = console[method].bind(console)
  }
  consoleOriginals = originals

  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      originals[method](...args)
      try {
        const text = utilFormat(...args)
        for (const line of text.split(/\r?\n/)) {
          writer.appendConsoleLine(line, method)
        }
      } catch {
        /* ignore mirror failures */
      }
    }
  }
}
