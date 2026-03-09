import type { ApiClient } from './api'
import type {
  AuthFile,
  AuthFilesResponse,
  CodexQuota,
  CopilotQuota,
  TestResult,
  UsageResponse,
  LogsResponse,
  LoggingToFileResponse,
  SetLoggingToFileRequest,
} from '@/types/api'

export async function uploadAuthFile(
  client: ApiClient,
  file: File
): Promise<void> {
  const formData = new FormData()
  formData.append('file', file, file.name)
  await client.upload<{ status?: string }>('/auth-files', formData)
}



export async function fetchAuthFiles(client: ApiClient): Promise<AuthFile[]> {
  const res = await client.get<AuthFilesResponse>('/auth-files')
  return res.files ?? []
}

export async function deleteAuthFile(
  client: ApiClient,
  name: string
): Promise<void> {
  await client.delete('/auth-files', { name })
}

export async function deleteAllAuthFiles(client: ApiClient): Promise<number> {
  const res = await client.delete<{ deleted?: number }>('/auth-files', { all: 'true' })
  return res.deleted ?? 0
}

export async function patchAuthFileStatus(
  client: ApiClient,
  name: string,
  disabled: boolean
): Promise<void> {
  await client.patch('/auth-files/status', { name, disabled })
}

export async function fetchUsage(client: ApiClient): Promise<UsageResponse> {
  return client.get<UsageResponse>('/usage')
}

export async function fetchLogs(client: ApiClient, after?: number): Promise<LogsResponse> {
  const path = after ? `/logs?after=${after}` : '/logs'
  return client.get<LogsResponse>(path)
}

export async function fetchLoggingEnabled(client: ApiClient): Promise<boolean> {
  const res = await client.get<LoggingToFileResponse>('/logging-to-file')
  return res['logging-to-file']
}

export async function setLoggingEnabled(client: ApiClient, enabled: boolean): Promise<boolean> {
  const res = await client.patch<LoggingToFileResponse>('/logging-to-file', {
    'logging-to-file': enabled,
  } satisfies SetLoggingToFileRequest)
  return res['logging-to-file']
}

// ─── Codex testing internals ────────────────────────────────────

interface ApiCallResponse {
  status_code: number
  header: Record<string, string[]>
  body: string
}

function getHeaderValues(headers: Record<string, string[]>, name: string): string[] {
  const target = name.toLowerCase()
  for (const [key, values] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return values
  }
  return []
}

function isCloudflareChallenge(res: ApiCallResponse): boolean {
  const cfMitigated = getHeaderValues(res.header, 'cf-mitigated').join(',').toLowerCase()
  if (cfMitigated.includes('challenge')) return true

  const setCookie = getHeaderValues(res.header, 'set-cookie').join(',').toLowerCase()
  if (setCookie.includes('__cf_bm=') || setCookie.includes('cf_clearance=')) {
    if (res.status_code === 403 || res.status_code === 429 || res.status_code === 503) {
      return true
    }
  }

  const contentType = getHeaderValues(res.header, 'content-type').join(',').toLowerCase()
  const body = res.body.toLowerCase()

  if (contentType.includes('text/html')) {
    if (body.includes('just a moment') || body.includes('/cdn-cgi/challenge-platform') || body.includes('_cf_chl_opt')) {
      return true
    }
  }

  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

const QUOTA_HINT_PATTERNS = [
  /\bquota\s+exceeded\b/i,
  /\brate\s+limit\s+exceeded\b/i,
  /\blimit_reached\b/i,
  /\btoo\s+many\s+requests\b/i,
  /\bstatus[_\s-]?code\s*[:=]?\s*429\b/i,
  /\bhttp\s*429\b/i,
  /配额已用尽|配额不足|已超额|额度不足|超出额度|限额已达|请求过于频繁/,
]

function shouldTreatChallengeAsQuota(authFile: AuthFile, now: number): boolean {
  const nextRetryAt = parseTimestamp(authFile.next_retry_after)
  if (nextRetryAt !== null && nextRetryAt > now) return true

  const statusMessage = authFile.status_message ?? ''
  return QUOTA_HINT_PATTERNS.some((pattern) => pattern.test(statusMessage))
}

/** Headers that match the latest codex CLI fingerprint */
const CODEX_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'codex-cli/1.0.8 (Mac OS 26.0.1; arm64)',
  Originator: 'codex',
}

async function requestCodexUsage(client: ApiClient, authFile: AuthFile): Promise<ApiCallResponse> {
  return client.post<ApiCallResponse>('/api-call', {
    auth_index: authFile.auth_index,
    method: 'GET',
    url: 'https://chatgpt.com/backend-api/codex/usage',
    header: CODEX_HEADERS,
  })
}

/**
 * Retry a request up to `maxRetries` times with delay when CF challenge is detected.
 * Returns the first non-CF response, or the last CF response if all retries fail.
 */
async function requestWithCfRetry(
  client: ApiClient,
  authFile: AuthFile,
  maxRetries: number = 2,
  delayMs: number = 1500,
): Promise<ApiCallResponse> {
  let lastRes = await requestCodexUsage(client, authFile)

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (!isCloudflareChallenge(lastRes)) return lastRes
    await delay(delayMs * (attempt + 1))
    lastRes = await requestCodexUsage(client, authFile)
  }

  return lastRes
}

function parseCodexQuota(body: string): CodexQuota | undefined {
  try {
    return JSON.parse(body) as CodexQuota
  } catch {
    return undefined
  }
}

function classifyCodexResponse(res: ApiCallResponse, now: number): TestResult | null {
  if (res.status_code === 401 || res.status_code === 403) {
    if (isCloudflareChallenge(res)) return null // signal: CF still blocking
    return { status: 'expired', statusCode: res.status_code, testedAt: now }
  }

  if (res.status_code === 429) {
    return { status: 'quota', statusCode: 429, testedAt: now }
  }

  if (res.status_code !== 200) {
    return { status: 'error', statusCode: res.status_code, message: res.body.slice(0, 120), testedAt: now }
  }

  const quota = parseCodexQuota(res.body)
  if (!quota) {
    return { status: 'valid', statusCode: 200, testedAt: now }
  }

  const rl = quota.rate_limit
  if (!rl.allowed || rl.limit_reached) {
    return { status: 'quota', statusCode: 200, testedAt: now, quota }
  }

  return { status: 'valid', statusCode: 200, testedAt: now, quota }
}

// ─── Public test entry ──────────────────────────────────────────

export async function testAuthFile(
  client: ApiClient,
  authFile: AuthFile
): Promise<TestResult> {
  const provider = (authFile.provider || authFile.type || '').toLowerCase()

  if (provider === 'github-copilot' || provider === 'copilot') {
    return testCopilotFile(client, authFile)
  }

  return testCodexFile(client, authFile)
}

async function testCodexFile(
  client: ApiClient,
  authFile: AuthFile
): Promise<TestResult> {
  const now = Date.now()

  try {
    const res = await requestWithCfRetry(client, authFile, 2, 1500)

    const result = classifyCodexResponse(res, now)
    if (result) return result

    // CF still blocking after retries — prefer quota classification if server metadata indicates quota-limited.
    if (shouldTreatChallengeAsQuota(authFile, now)) {
      return {
        status: 'quota',
        statusCode: 429,
        message: 'CF challenge; using server quota hint',
        testedAt: now,
      }
    }

    // Fall back to CPA server status when no explicit quota hint exists.
    if (authFile.status === 'active') {
      return { status: 'valid', statusCode: res.status_code, message: 'CF challenge; using server status', testedAt: now }
    }
    if (authFile.status === 'error') {
      return { status: 'error', statusCode: res.status_code, message: authFile.status_message ?? 'CF challenge', testedAt: now }
    }
    if (authFile.status === 'disabled') {
      return { status: 'error', statusCode: res.status_code, message: '凭证已禁用', testedAt: now }
    }
    if (authFile.status === 'pending' || authFile.status === 'refreshing') {
      return {
        status: 'error',
        statusCode: res.status_code,
        message: `CF challenge（服务端状态：${authFile.status}）`,
        testedAt: now,
      }
    }

    return {
      status: 'error',
      statusCode: res.status_code,
      message: `Cloudflare challenge (server: ${authFile.status})`,
      testedAt: now,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误'
    return { status: 'error', message, testedAt: now }
  }
}

async function testCopilotFile(
  client: ApiClient,
  authFile: AuthFile
): Promise<TestResult> {
  const now = Date.now()
  const baseHeader = {
    Authorization: 'Bearer $TOKEN$',
    'User-Agent': 'GitHubCopilot/1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  try {
    const res = await client.post<ApiCallResponse>('/api-call', {
      auth_index: authFile.auth_index,
      method: 'GET',
      url: 'https://api.github.com/user',
      header: baseHeader,
    })

    if (res.status_code === 401 || res.status_code === 403) {
      return { status: 'expired', statusCode: res.status_code, testedAt: now }
    }

    if (res.status_code === 429) {
      return { status: 'quota', statusCode: 429, testedAt: now }
    }

    if (res.status_code !== 200) {
      return { status: 'error', statusCode: res.status_code, message: res.body.slice(0, 120), testedAt: now }
    }

    try {
      const quotaRes = await client.post<ApiCallResponse>('/api-call', {
        auth_index: authFile.auth_index,
        method: 'GET',
        url: 'https://api.github.com/copilot_internal/user',
        header: {
          Authorization: 'Bearer $TOKEN$',
          Accept: 'application/json',
          'User-Agent': 'GitHubCopilotChat/0.26.7',
          'x-github-api-version': '2025-04-01',
        },
      })

      if (quotaRes.status_code === 200) {
        const copilotQuota = JSON.parse(quotaRes.body) as CopilotQuota
        const snap = copilotQuota.quota_snapshots?.premium_interactions
        const remaining = snap?.remaining ?? snap?.quota_remaining ?? 0
        const entitlement = snap?.entitlement ?? 0
        if (!snap?.unlimited && entitlement > 0 && remaining === 0) {
          return { status: 'quota', statusCode: 200, testedAt: now, copilotQuota }
        }
        return { status: 'valid', statusCode: 200, testedAt: now, copilotQuota }
      }

      return { status: 'valid', statusCode: 200, testedAt: now, message: `quota ${quotaRes.status_code}: ${quotaRes.body.slice(0, 80)}` }
    } catch {
      return { status: 'valid', statusCode: 200, testedAt: now, message: 'quota endpoint unreachable' }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误'
    return { status: 'error', message, testedAt: now }
  }
}
