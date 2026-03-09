/**
 * Vite plugin that exposes local API endpoints for the register-machine.
 *
 * Endpoints:
 *   POST /api/register/start    — spawn register-machine.py
 *   GET  /api/register/progress — SSE stream for active run
 *   GET  /api/register/tokens   — list token files in output dir
 *   GET  /api/register/tokens/:name — read token file content
 *   DELETE /api/register/tokens/:name — delete token file
 */
import type { Plugin, ViteDevServer } from 'vite'
import { spawn, type ChildProcess } from 'node:child_process'
import { readdir, readFile, unlink, stat, access, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const PROJECT_ROOT = process.cwd()
const OUTPUT_DIR = join(PROJECT_ROOT, 'output')
const LEGACY_OUTPUT_DIR = join(PROJECT_ROOT, 'output')
const SCRIPT_DIR = join(PROJECT_ROOT, 'scripts')
const SCRIPT_PATH = join(SCRIPT_DIR, 'register-machine.py')
const VENV_PYTHON = join(PROJECT_ROOT, '.venv', 'bin', 'python3')
const MAX_COUNT = 50
const MAX_WORKERS = 10
const MAX_LOG_LINES = 500
const MAX_SSE_LISTENERS = 10

interface RunState {
  proc: ChildProcess | null
  lines: string[]
  status: 'idle' | 'running' | 'done' | 'error'
  startedAt: number
  /** SSE listeners waiting for new lines */
  listeners: Set<ServerResponse>
}

const run: RunState = {
  proc: null,
  lines: [],
  status: 'idle',
  startedAt: 0,
  listeners: new Set(),
}

function sendJSON(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(body))
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve({})
      }
    })
  })
}

function broadcastLine(line: string) {
  const data = `data: ${JSON.stringify({ type: 'log', line })}\n\n`
  for (const res of run.listeners) {
    res.write(data)
  }
}

function broadcastStatus(status: string) {
  const data = `data: ${JSON.stringify({ type: 'status', status })}\n\n`
  for (const res of run.listeners) {
    res.write(data)
  }
}

function isValidTokenFileName(name: string): boolean {
  return /^codex-[A-Za-z0-9_-]+\.json$/.test(name) && !name.includes('..') && !name.includes('/') && !name.includes('\\')
}

async function scriptExists(): Promise<boolean> {
  try {
    await access(SCRIPT_PATH)
    return true
  } catch {
    return false
  }
}

async function normalizeLegacyOutputFiles(): Promise<void> {
  try {
    await mkdir(OUTPUT_DIR, { recursive: true })

    const moveFromLegacyDir = async () => {
      try {
        const legacyFiles = await readdir(LEGACY_OUTPUT_DIR)
        await Promise.all(
          legacyFiles
            .filter((name) => (name.startsWith('token_') || name.startsWith('codex_') || name.startsWith('codex-')) && name.endsWith('.json'))
            .map(async (name) => {
              const nextName = name.startsWith('token_')
                ? `codex-${name.slice('token_'.length)}`
                : name.startsWith('codex_')
                  ? `codex-${name.slice('codex_'.length)}`
                  : name
              await rename(join(LEGACY_OUTPUT_DIR, name), join(OUTPUT_DIR, nextName))
            })
        )
      } catch {
        // noop
      }
    }

    const renameInOutputs = async () => {
      try {
        const files = await readdir(OUTPUT_DIR)
        await Promise.all(
          files
            .filter((name) => (name.startsWith('token_') || name.startsWith('codex_')) && name.endsWith('.json'))
            .map(async (name) => {
              const nextName = name.startsWith('token_')
                ? `codex-${name.slice('token_'.length)}`
                : `codex-${name.slice('codex_'.length)}`
              await rename(join(OUTPUT_DIR, name), join(OUTPUT_DIR, nextName))
            })
        )
      } catch {
        // noop
      }
    }

    await moveFromLegacyDir()
    await renameInOutputs()
  } catch {
    // noop
  }
}

void normalizeLegacyOutputFiles().catch(() => {})

export default function registerPlugin(): Plugin {
  return {
    name: 'register-machine',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        // CORS preflight
        if (req.method === 'OPTIONS' && url.startsWith('/api/register')) {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }

        // POST /api/register/start
        if (req.method === 'POST' && url === '/api/register/start') {
          if (run.status === 'running') {
            sendJSON(res, 409, { error: '注册任务正在运行中' })
            return
          }

          if (!(await scriptExists())) {
            sendJSON(res, 404, { error: '脚本不存在～' })
            return
          }

          await mkdir(OUTPUT_DIR, { recursive: true })

          const body = await parseBody(req)

          const rawCount = Number(body.count)
          const rawWorkers = Number(body.workers)
          const count = Number.isFinite(rawCount) ? Math.min(MAX_COUNT, Math.max(1, Math.trunc(rawCount))) : 1
          const workers = Number.isFinite(rawWorkers) ? Math.min(MAX_WORKERS, Math.max(1, Math.trunc(rawWorkers))) : 3
          const proxy = typeof body.proxy === 'string' ? body.proxy.trim() : ''

          if (proxy && !/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(proxy)) {
            sendJSON(res, 400, { error: '代理格式无效' })
            return
          }

          const args = [
            SCRIPT_PATH,
            '--count', String(count),
            '--workers', String(workers),
          ]
          if (proxy) {
            args.push('--proxy', proxy)
          }

          run.lines = []
          run.status = 'running'
          run.startedAt = Date.now()

          const proc = spawn(VENV_PYTHON, args, {
            cwd: PROJECT_ROOT,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          run.proc = proc

          const handleData = (chunk: Buffer) => {
            // Strip ANSI escape codes and rich formatting for clean display
            const raw = chunk.toString('utf-8')
            const lines = raw.split('\n').filter((l) => l.trim())
            for (const line of lines) {
              const clean = line.replace(
                /\x1b\[[0-9;]*[a-zA-Z]|\[.*?\]/g,
                ''
              ).trim()
              if (clean) {
                run.lines.push(clean)
                if (run.lines.length > MAX_LOG_LINES) {
                  run.lines = run.lines.slice(-MAX_LOG_LINES)
                }
                broadcastLine(clean)
              }
            }
          }

          proc.stdout?.on('data', handleData)
          proc.stderr?.on('data', handleData)

          proc.on('close', (code) => {
            run.status = code === 0 ? 'done' : 'error'
            run.proc = null
            void normalizeLegacyOutputFiles().catch(() => {})
            broadcastStatus(run.status)
          })

          proc.on('error', (err) => {
            run.lines.push(`进程错误: ${err.message}`)
            if (run.lines.length > MAX_LOG_LINES) {
              run.lines = run.lines.slice(-MAX_LOG_LINES)
            }
            broadcastLine(`进程错误: ${err.message}`)
            run.status = 'error'
            run.proc = null
            broadcastStatus('error')
          })

          sendJSON(res, 200, { ok: true, count, workers, proxy: proxy || null })
          return
        }

        // POST /api/register/stop
        if (req.method === 'POST' && url === '/api/register/stop') {
          if (run.proc) {
            run.proc.kill('SIGTERM')
            run.status = 'done'
            run.proc = null
            broadcastStatus('done')
          }
          sendJSON(res, 200, { ok: true })
          return
        }

        // GET /api/register/progress — SSE
        if (req.method === 'GET' && url === '/api/register/progress') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          })

          if (run.listeners.size >= MAX_SSE_LISTENERS) {
            sendJSON(res, 429, { error: '监听连接过多，请稍后重试' })
            return
          }

          // Send current state
          res.write(`data: ${JSON.stringify({ type: 'init', status: run.status, lines: run.lines })}\n\n`)

          run.listeners.add(res)
          req.on('close', () => {
            run.listeners.delete(res)
          })
          return
        }

        // GET /api/register/tokens
        if (req.method === 'GET' && url === '/api/register/tokens') {
          try {
            if (!(await scriptExists())) {
              sendJSON(res, 200, { scriptMissing: true, tokens: [] })
              return
            }

            const files = await readdir(OUTPUT_DIR)
            const tokenFiles = files.filter((f) => isValidTokenFileName(f))

            const tokens = await Promise.all(
              tokenFiles.map(async (name) => {
                try {
                  const content = await readFile(join(OUTPUT_DIR, name), 'utf-8')
                  const data = JSON.parse(content)
                  const fileStat = await stat(join(OUTPUT_DIR, name))
                  return {
                    fileName: name,
                    email: data.email ?? '',
                    type: data.type ?? 'codex',
                    expired: data.expired ?? '',
                    accountId: data.account_id ?? '',
                    createdAt: fileStat.birthtimeMs,
                  }
                } catch {
                  return { fileName: name, email: '', type: 'unknown', expired: '', accountId: '', createdAt: 0 }
                }
              })
            )

            // Sort by creation time descending
            tokens.sort((a, b) => b.createdAt - a.createdAt)
            sendJSON(res, 200, { scriptMissing: false, tokens })
          } catch {
            sendJSON(res, 200, { scriptMissing: false, tokens: [] })
          }
          return
        }

        // GET /api/register/tokens/:name
        const readMatch = url.match(/^\/api\/register\/tokens\/([^/]+)$/)
        if (req.method === 'GET' && readMatch) {
          const name = decodeURIComponent(readMatch[1])
          if (!isValidTokenFileName(name)) {
            sendJSON(res, 400, { error: '无效的文件名' })
            return
          }
          try {
            const content = await readFile(join(OUTPUT_DIR, name), 'utf-8')
            sendJSON(res, 200, { content: JSON.parse(content) })
          } catch {
            sendJSON(res, 404, { error: '文件不存在' })
          }
          return
        }

        // DELETE /api/register/tokens/:name
        const delMatch = url.match(/^\/api\/register\/tokens\/([^/]+)$/)
        if (req.method === 'DELETE' && delMatch) {
          const name = decodeURIComponent(delMatch[1])
          if (!isValidTokenFileName(name)) {
            sendJSON(res, 400, { error: '无效的文件名' })
            return
          }
          try {
            await unlink(join(OUTPUT_DIR, name))
            sendJSON(res, 200, { ok: true })
          } catch {
            sendJSON(res, 404, { error: '文件不存在或删除失败' })
          }
          return
        }

        next()
      })
    },
  }
}
