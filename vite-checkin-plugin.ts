/**
 * Vite plugin that proxies check-in requests to New API sites.
 *
 * Since many New API sites use third-party OAuth (LinuxDO, GitHub, etc.),
 * we avoid implementing login. Instead, the user logs in via their browser
 * and supplies session cookies + user ID to this plugin.
 *
 * Endpoints:
 *   POST /api/checkin/verify   — verify session is valid, return user info
 *   POST /api/checkin/do       — perform daily check-in
 *   POST /api/checkin/status   — get check-in status for current month
 *   POST /api/checkin/balance  — refresh balance from /api/user/self
 *   POST /api/checkin/logs     — fetch recent topup logs (checkin rewards)
 */
import type { Plugin, ViteDevServer } from 'vite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface CheckinSiteConfig {
  id: string
  name: string
  siteUrl: string
  cookie: string
  userId: number
}

interface CheckinConfigData {
  activeSiteId: string | null
  sites: CheckinSiteConfig[]
}

const CONFIG_DIR = join(homedir(), '.cliproxy-dashboard')
const CONFIG_PATH = join(CONFIG_DIR, 'register.yaml')
const CONFIG_DISPLAY_PATH = '~/.cliproxy-dashboard/register.yaml'
const DEFAULT_SITE_URL = 'https://example.com'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_CONFIG_SIZE_BYTES = 256 * 1024
const MAX_CONFIG_LINES = 2000

function sendJSON(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  })
  res.end(JSON.stringify(body))
}

function sanitizeSite(site: Partial<CheckinSiteConfig>): CheckinSiteConfig {
  const fallbackId = `site-${Date.now()}`
  const id = typeof site.id === 'string' && site.id.trim() ? site.id.trim() : fallbackId
  const siteUrl = normalizeSiteUrl(typeof site.siteUrl === 'string' && site.siteUrl.trim() ? site.siteUrl.trim() : DEFAULT_SITE_URL)
  const cookie = typeof site.cookie === 'string' ? site.cookie.trim() : ''
  const parsedUserId = Number(site.userId)
  const userId = Number.isFinite(parsedUserId) && parsedUserId > 0 ? Math.trunc(parsedUserId) : 0
  const name = typeof site.name === 'string' && site.name.trim() ? site.name.trim() : siteUrl.replace(/^https?:\/\//, '')
  return { id, name, siteUrl, cookie, userId }
}

function parseMaybeQuoted(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"')
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'")
  }
  return trimmed
}

function toYamlSafeString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function parseCheckinYaml(content: string): CheckinConfigData {
  if (content.length > MAX_CONFIG_SIZE_BYTES) {
    throw new Error('配置文件过大')
  }

  const lines = content.split(/\r?\n/)
  if (lines.length > MAX_CONFIG_LINES) {
    throw new Error('配置文件行数过多')
  }
  const sites: CheckinSiteConfig[] = []
  let activeSiteId: string | null = null
  let current: Partial<CheckinSiteConfig> | null = null

  const commitCurrent = () => {
    if (!current) return
    sites.push(sanitizeSite(current))
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (line.startsWith('activeSiteId:')) {
      const val = parseMaybeQuoted(line.slice('activeSiteId:'.length))
      activeSiteId = val || null
      continue
    }

    if (line === 'sites:') {
      continue
    }

    if (line.startsWith('- ')) {
      commitCurrent()
      current = {}
      const rest = line.slice(2).trim()
      if (!rest) continue
      const sep = rest.indexOf(':')
      if (sep > 0) {
        const key = rest.slice(0, sep).trim()
        const val = parseMaybeQuoted(rest.slice(sep + 1))
        if (key === 'id') current.id = val
        else if (key === 'name') current.name = val
        else if (key === 'siteUrl') current.siteUrl = val
        else if (key === 'cookie') current.cookie = val
        else if (key === 'userId') current.userId = Number(val) || 0
      }
      continue
    }

    if (!current) continue

    const sep = line.indexOf(':')
    if (sep <= 0) continue
    const key = line.slice(0, sep).trim()
    const val = parseMaybeQuoted(line.slice(sep + 1))
    if (key === 'id') current.id = val
    else if (key === 'name') current.name = val
    else if (key === 'siteUrl') current.siteUrl = val
    else if (key === 'cookie') current.cookie = val
    else if (key === 'userId') current.userId = Number(val) || 0
  }

  commitCurrent()

  if (sites.length === 0) {
    const initial = sanitizeSite({
      id: `site-${Date.now()}`,
      name: DEFAULT_SITE_URL.replace(/^https?:\/\//, ''),
      siteUrl: DEFAULT_SITE_URL,
      cookie: '',
      userId: 0,
    })
    return { activeSiteId: initial.id, sites: [initial] }
  }

  const exists = activeSiteId ? sites.some((site) => site.id === activeSiteId) : false
  return {
    activeSiteId: exists ? activeSiteId : sites[0].id,
    sites,
  }
}

function stringifyCheckinYaml(config: CheckinConfigData): string {
  const activeSiteId = config.activeSiteId ?? (config.sites[0]?.id ?? '')
  const lines: string[] = [
    '# CLIProxy Dashboard checkin config',
    `activeSiteId: ${toYamlSafeString(activeSiteId)}`,
    'sites:',
  ]

  for (const site of config.sites) {
    lines.push(`  - id: ${toYamlSafeString(site.id)}`)
    lines.push(`    name: ${toYamlSafeString(site.name)}`)
    lines.push(`    siteUrl: ${toYamlSafeString(site.siteUrl)}`)
    lines.push(`    cookie: ${toYamlSafeString(site.cookie)}`)
    lines.push(`    userId: ${site.userId}`)
  }

  return `${lines.join('\n')}\n`
}

async function readCheckinConfig(): Promise<CheckinConfigData> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    const parsed = parseCheckinYaml(raw)
    if (parsed.sites.length > 0) {
      return parsed
    }
  } catch {
    // init below
  }

  const initial: CheckinConfigData = {
    activeSiteId: `site-${Date.now()}`,
    sites: [sanitizeSite({ siteUrl: DEFAULT_SITE_URL, name: DEFAULT_SITE_URL.replace(/^https?:\/\//, '') })],
  }
  await writeCheckinConfig(initial)
  return initial
}

async function writeCheckinConfig(config: CheckinConfigData): Promise<CheckinConfigData> {
  const sites = config.sites.length > 0
    ? config.sites.map((site) => sanitizeSite(site))
    : [sanitizeSite({ siteUrl: DEFAULT_SITE_URL, name: DEFAULT_SITE_URL.replace(/^https?:\/\//, '') })]

  const activeExists = config.activeSiteId ? sites.some((site) => site.id === config.activeSiteId) : false
  const normalized: CheckinConfigData = {
    activeSiteId: activeExists ? config.activeSiteId : sites[0].id,
    sites,
  }

  configWriteQueue = configWriteQueue.then(async () => {
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(CONFIG_PATH, stringifyCheckinYaml(normalized), 'utf-8')
  })

  await configWriteQueue
  return normalized
}

function parseBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve({})
      }
    })

    req.on('error', (err) => {
      reject(err)
    })
  })
}

/** Normalize site URL — strip trailing slash */
function normalizeSiteUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()

  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0'
  ) {
    return true
  }

  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true

  const m172 = h.match(/^172\.(\d{1,3})\./)
  if (m172) {
    const seg = Number(m172[1])
    if (seg >= 16 && seg <= 31) return true
  }

  return false
}

function isSafeSiteUrl(siteUrl: string): boolean {
  try {
    const parsed = new URL(siteUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    if (!parsed.hostname) return false
    if (isPrivateHostname(parsed.hostname)) return false
    return true
  } catch {
    return false
  }
}

function assertSafeSiteUrl(siteUrl: string): string | null {
  if (!siteUrl) return '缺少站点地址'
  if (!isSafeSiteUrl(siteUrl)) {
    return '站点地址不安全，请使用公网 HTTP/HTTPS 地址'
  }
  return null
}

/** Build common headers for upstream requests */
function buildHeaders(cookie: string, userId: number): Record<string, string> {
  const h: Record<string, string> = { Cookie: cookie }
  if (userId > 0) {
    h['New-Api-User'] = String(userId)
  }
  return h
}

let configWriteQueue: Promise<void> = Promise.resolve()

export default function checkinPlugin(): Plugin {
  return {
    name: 'newapi-checkin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''

        // CORS preflight
        if (req.method === 'OPTIONS' && url.startsWith('/api/checkin')) {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          })
          res.end()
          return
        }

        // GET /api/checkin/config — load checkin config from ~/.cliproxy-dashboard/register.yaml
        if (req.method === 'GET' && url === '/api/checkin/config') {
          try {
            const config = await readCheckinConfig()
            sendJSON(res, 200, { success: true, data: config, path: CONFIG_DISPLAY_PATH })
          } catch (err) {
            console.error('[checkin] read config failed:', err)
            sendJSON(res, 500, {
              success: false,
              message: '读取签到配置失败',
            })
          }
          return
        }

        // POST /api/checkin/config — save full checkin config
        if (req.method === 'POST' && url === '/api/checkin/config') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const incomingSites = Array.isArray(body.sites) ? body.sites as Partial<CheckinSiteConfig>[] : []
          const incomingActiveSiteId = typeof body.activeSiteId === 'string' ? body.activeSiteId : null

          const unsafeSite = incomingSites
            .map((site) => normalizeSiteUrl(String(site.siteUrl ?? '')))
            .find((siteUrl) => siteUrl && !isSafeSiteUrl(siteUrl))
          if (unsafeSite) {
            sendJSON(res, 400, { success: false, message: '存在不安全的站点地址' })
            return
          }

          try {
            const saved = await writeCheckinConfig({
              activeSiteId: incomingActiveSiteId,
              sites: incomingSites.map((site) => sanitizeSite(site)),
            })
            sendJSON(res, 200, { success: true, data: saved, path: CONFIG_DISPLAY_PATH })
          } catch (err) {
            console.error('[checkin] save config failed:', err)
            sendJSON(res, 500, {
              success: false,
              message: '保存签到配置失败',
            })
          }
          return
        }

        // POST /api/checkin/sites — add a new checkin site
        if (req.method === 'POST' && url === '/api/checkin/sites') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const siteUrl = normalizeSiteUrl(String(body.siteUrl ?? ''))
          const cookie = String(body.cookie ?? '').trim()
          const userId = Number(body.userId) || 0
          const name = String(body.name ?? '').trim()

          const safeError = assertSafeSiteUrl(siteUrl)
          if (safeError) {
            sendJSON(res, 400, { success: false, message: safeError })
            return
          }

          if (!cookie) {
            sendJSON(res, 400, { success: false, message: '缺少 Cookie' })
            return
          }

          try {
            const current = await readCheckinConfig()
            const nextSite = sanitizeSite({
              id: `site-${Date.now()}`,
              name: name || siteUrl.replace(/^https?:\/\//, ''),
              siteUrl,
              cookie,
              userId,
            })

            const nextConfig = await writeCheckinConfig({
              activeSiteId: nextSite.id,
              sites: [...current.sites, nextSite],
            })
            sendJSON(res, 200, { success: true, data: nextConfig, path: CONFIG_DISPLAY_PATH })
          } catch (err) {
            console.error('[checkin] add site failed:', err)
            sendJSON(res, 500, {
              success: false,
              message: '新增签到站点失败',
            })
          }
          return
        }

        // DELETE /api/checkin/sites/:id — remove one checkin site
        const deleteSiteMatch = url.match(/^\/api\/checkin\/sites\/([^/]+)$/)
        if (req.method === 'DELETE' && deleteSiteMatch) {
          const targetId = decodeURIComponent(deleteSiteMatch[1])

          try {
            const current = await readCheckinConfig()
            const remaining = current.sites.filter((site) => site.id !== targetId)
            const nextConfig = await writeCheckinConfig({
              activeSiteId: current.activeSiteId === targetId ? null : current.activeSiteId,
              sites: remaining,
            })
            sendJSON(res, 200, { success: true, data: nextConfig, path: CONFIG_DISPLAY_PATH })
          } catch (err) {
            console.error('[checkin] delete site failed:', err)
            sendJSON(res, 500, {
              success: false,
              message: '删除签到站点失败',
            })
          }
          return
        }

        // POST /api/checkin/verify — test session validity
        if (req.method === 'POST' && url === '/api/checkin/verify') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const siteUrl = normalizeSiteUrl(String(body.siteUrl ?? ''))
          const cookie = String(body.cookie ?? '')
          const userId = Number(body.userId) || 0

          const safeError = assertSafeSiteUrl(siteUrl)
          if (safeError || !cookie) {
            sendJSON(res, 400, { success: false, message: safeError ?? '缺少 Cookie' })
            return
          }

          try {
            const selfRes = await fetch(`${siteUrl}/api/user/self`, {
              method: 'GET',
              headers: buildHeaders(cookie, userId),
            })

            const selfData = await selfRes.json() as {
              success: boolean
              message?: string
              data?: {
                id: number
                username: string
                display_name: string
                role: number
                quota: number
                used_quota: number
              }
            }

            if (!selfData.success) {
              const msg = selfData.message ?? ''
              const needsUserId = msg.includes('New-Api-User')

              sendJSON(res, 200, {
                success: false,
                message: msg || '会话无效',
                needsUserId,
              })
              return
            }

            sendJSON(res, 200, {
              success: true,
              data: {
                userId: selfData.data?.id,
                username: selfData.data?.username ?? selfData.data?.display_name,
                quota: selfData.data?.quota,
                usedQuota: selfData.data?.used_quota,
              },
            })
          } catch (err) {
            console.error('[checkin] verify failed:', err)
            sendJSON(res, 200, {
              success: false,
              message: '网络错误',
            })
          }
          return
        }

        // POST /api/checkin/status
        if (req.method === 'POST' && url === '/api/checkin/status') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const siteUrl = normalizeSiteUrl(String(body.siteUrl ?? ''))
          const cookie = String(body.cookie ?? '')
          const userId = Number(body.userId) || 0
          const month = String(body.month ?? new Date().toISOString().slice(0, 7))

          const safeError = assertSafeSiteUrl(siteUrl)
          if (safeError || !cookie) {
            sendJSON(res, 400, { success: false, message: safeError ?? '缺少必填参数' })
            return
          }

          try {
            const statusRes = await fetch(
              `${siteUrl}/api/user/checkin?month=${encodeURIComponent(month)}`,
              {
                method: 'GET',
                headers: buildHeaders(cookie, userId),
              }
            )

            const statusData = await statusRes.json()
            sendJSON(res, 200, statusData)
          } catch (err) {
            console.error('[checkin] status failed:', err)
            sendJSON(res, 200, {
              success: false,
              message: '网络错误',
            })
          }
          return
        }

        // POST /api/checkin/do
        if (req.method === 'POST' && url === '/api/checkin/do') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const siteUrl = normalizeSiteUrl(String(body.siteUrl ?? ''))
          const cookie = String(body.cookie ?? '')
          const userId = Number(body.userId) || 0

          const safeError = assertSafeSiteUrl(siteUrl)
          if (safeError || !cookie) {
            sendJSON(res, 400, { success: false, message: safeError ?? '缺少必填参数' })
            return
          }

          try {
            const checkinRes = await fetch(`${siteUrl}/api/user/checkin`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...buildHeaders(cookie, userId),
              },
            })

            const checkinData = await checkinRes.json()

            // After successful checkin, also fetch updated balance
            if (checkinData.success) {
              try {
                const selfRes = await fetch(`${siteUrl}/api/user/self`, {
                  method: 'GET',
                  headers: buildHeaders(cookie, userId),
                })
                const selfData = await selfRes.json() as {
                  success: boolean
                  data?: { quota: number; used_quota: number; request_count: number }
                }
                if (selfData.success && selfData.data) {
                  checkinData.balance = {
                    quota: selfData.data.quota,
                    usedQuota: selfData.data.used_quota,
                    requestCount: selfData.data.request_count,
                  }
                }
              } catch {
                // balance fetch is best-effort
              }
            }

            sendJSON(res, 200, checkinData)
          } catch (err) {
            console.error('[checkin] do failed:', err)
            sendJSON(res, 200, {
              success: false,
              message: '网络错误',
            })
          }
          return
        }

        // POST /api/checkin/balance — refresh balance
        if (req.method === 'POST' && url === '/api/checkin/balance') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const siteUrl = normalizeSiteUrl(String(body.siteUrl ?? ''))
          const cookie = String(body.cookie ?? '')
          const userId = Number(body.userId) || 0

          const safeError = assertSafeSiteUrl(siteUrl)
          if (safeError || !cookie) {
            sendJSON(res, 400, { success: false, message: safeError ?? '缺少必填参数' })
            return
          }

          try {
            const selfRes = await fetch(`${siteUrl}/api/user/self`, {
              method: 'GET',
              headers: buildHeaders(cookie, userId),
            })
            const selfData = await selfRes.json() as {
              success: boolean
              data?: { quota: number; used_quota: number; request_count: number }
            }
            if (selfData.success && selfData.data) {
              sendJSON(res, 200, {
                success: true,
                data: {
                  quota: selfData.data.quota,
                  usedQuota: selfData.data.used_quota,
                  requestCount: selfData.data.request_count,
                },
              })
            } else {
              sendJSON(res, 200, { success: false, message: '获取余额失败' })
            }
          } catch (err) {
            console.error('[checkin] balance failed:', err)
            sendJSON(res, 200, {
              success: false,
              message: '网络错误',
            })
          }
          return
        }

        // POST /api/checkin/logs — fetch recent topup logs (type=1)
        if (req.method === 'POST' && url === '/api/checkin/logs') {
          let body: Record<string, unknown>
          try {
            body = await parseBody(req)
          } catch (err) {
            sendJSON(res, 413, {
              success: false,
              message: err instanceof Error ? err.message : '请求体无效',
            })
            return
          }

          const siteUrl = normalizeSiteUrl(String(body.siteUrl ?? ''))
          const cookie = String(body.cookie ?? '')
          const userId = Number(body.userId) || 0

          const safeError = assertSafeSiteUrl(siteUrl)
          if (safeError || !cookie) {
            sendJSON(res, 400, { success: false, message: safeError ?? '缺少必填参数' })
            return
          }

          try {
            // Fetch type=1 (topup) logs which include checkin rewards
            const logsRes = await fetch(
              `${siteUrl}/api/log/self?type=1&p=0`,
              {
                method: 'GET',
                headers: buildHeaders(cookie, userId),
              }
            )
            const logsData = await logsRes.json()
            sendJSON(res, 200, logsData)
          } catch (err) {
            console.error('[checkin] logs failed:', err)
            sendJSON(res, 200, {
              success: false,
              message: '网络错误',
            })
          }
          return
        }

        next()
      })
    },
  }
}
