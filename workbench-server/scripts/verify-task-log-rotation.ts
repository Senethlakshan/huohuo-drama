/**
 * 任务日志按日滚动 / 保留天数修剪
 * Run: npx tsx scripts/verify-task-log-rotation.ts
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  TaskLogWriter,
  formatTaskLogDate,
  migrateLegacyTaskLog,
  pruneTaskLogsOlderThan,
  resolveTaskLogRetentionDays,
  taskLogFileForDate,
} from '../src/common/task/task-log-writer.js'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

const root = join(tmpdir(), `huohuo-task-log-${Date.now()}`)
mkdirSync(root, { recursive: true })

try {
  assert(resolveTaskLogRetentionDays({} as NodeJS.ProcessEnv) === 30, 'default retention 30')
  assert(resolveTaskLogRetentionDays({ TASK_LOG_RETENTION_DAYS: '7' } as NodeJS.ProcessEnv) === 7, 'env 7')
  assert(resolveTaskLogRetentionDays({ TASK_LOG_RETENTION_DAYS: '0' } as NodeJS.ProcessEnv) === 30, 'invalid 0 → 30')

  const today = formatTaskLogDate()
  const old = '2020-01-01'
  writeFileSync(join(root, `task-${old}.log`), 'old\n', 'utf8')
  writeFileSync(join(root, `task-${today}.log`), 'today\n', 'utf8')
  writeFileSync(join(root, 'noise.txt'), 'x\n', 'utf8')

  const removed = pruneTaskLogsOlderThan({
    logDir: root,
    retentionDays: 3,
    today,
  })
  assert(removed.includes(`task-${old}.log`), 'old dated log pruned')
  assert(existsSync(join(root, `task-${today}.log`)), 'today kept')
  assert(existsSync(join(root, 'noise.txt')), 'non-task files kept')

  writeFileSync(join(root, 'task.log'), 'legacy-line\n', 'utf8')
  const mig = migrateLegacyTaskLog({ logDir: root })
  assert(mig.migrated, 'legacy migrated')
  assert(!existsSync(join(root, 'task.log')), 'legacy removed')
  const target = taskLogFileForDate(today, root)
  assert(existsSync(target), 'dated target exists')
  const body = readFileSync(target, 'utf8')
  assert(body.includes('legacy-line'), 'legacy content preserved')

  const writer = new TaskLogWriter({ logDir: root, retentionDays: 30 })
  writer.emit('Test', 'rotation-ok', { n: 1 }, 'INFO')
  const path = writer.currentLogPath()
  assert(path.endsWith(`task-${today}.log`), `path=${path}`)
  let logged = readFileSync(path, 'utf8')
  assert(/^\d{4}-\d{2}-\d{2} /.test(logged.trim().split('\n').pop() || ''), 'file lines have date')
  assert(logged.includes('[Test] rotation-ok'), 'emit content')

  writer.appendConsoleLine('GET /api/v1/health 200 3ms', 'log')
  logged = readFileSync(path, 'utf8')
  assert(logged.includes('GET /api/v1/health 200 3ms'), 'console mirror line')

  console.log('verify-task-log-rotation OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
