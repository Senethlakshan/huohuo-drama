import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatSanitizedLogPreview,
  redactUrl,
  sanitizeForLog,
} from '../security/log-redact.js'

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'

const tone = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
} as const

/** 持久化任务日志，避免终端滚动冲掉 Novel 管线断点线索 */
const TASK_LOG_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../logs/task.log',
)

export { redactUrl, sanitizeForLog }

export class TaskLogWriter {
  private fileReady = false

  private levelColor(level: LogLevel): string {
    switch (level) {
      case 'SUCCESS': return tone.green
      case 'WARN': return tone.yellow
      case 'ERROR': return tone.red
      default: return tone.cyan
    }
  }

  private timestamp(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }

  private appendFile(line: string) {
    try {
      if (!this.fileReady) {
        mkdirSync(dirname(TASK_LOG_FILE), { recursive: true })
        this.fileReady = true
      }
      appendFileSync(TASK_LOG_FILE, `${line}\n`, 'utf8')
    } catch {
      /* 文件日志失败不影响主流程 */
    }
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

  emit(scope: string, action: string, meta?: Record<string, unknown>, level: LogLevel = 'INFO') {
    const color = this.levelColor(level)
    const ts = this.timestamp()
    const metaStr = this.stringifyMeta(meta)
    console.log(
      `${tone.dim}${ts}${tone.reset} ${color}[${scope}]${tone.reset} ${action}${metaStr}`,
    )
    this.appendFile(`${ts} [${level}] [${scope}] ${action}${metaStr}`)
  }

  emitPayload(scope: string, action: string, payload: unknown) {
    const sanitized = this.applyClipping(sanitizeForLog(payload))
    const serialized = typeof sanitized === 'string'
      ? sanitized
      : JSON.stringify(sanitized, null, 2)
    const ts = this.timestamp()
    console.log(`${tone.dim}${ts}${tone.reset} ${tone.blue}[${scope}]${tone.reset} ${action}\n${serialized}`)
    this.appendFile(`${ts} [INFO] [${scope}] ${action} ${serialized.slice(0, 2000)}`)
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
