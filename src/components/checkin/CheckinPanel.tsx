import { useState, useEffect, useCallback } from 'react'

// ─── NewAPI quota conversion ────────────────────────────────────
const QUOTA_PER_UNIT = 500_000

function quotaToUSD(quota: number): number {
  return quota / QUOTA_PER_UNIT
}

function formatUSD(quota: number): string {
  const usd = quotaToUSD(quota)
  if (usd >= 1000) return `$${usd.toFixed(0)}`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00')}`
}

// ─── Interfaces ─────────────────────────────────────────────────
interface SessionData {
  userId: number
  username: string
  quota: number
  usedQuota: number
  requestCount: number
}

interface CheckinStats {
  enabled: boolean
  min_quota: number
  max_quota: number
  stats?: {
    checked_in_today: boolean
    total_checkins: number
    continuous_days: number
    checkin_dates: string[]
  }
}

interface CheckinLogItem {
  id: number
  created_at: number
  content: string
  quota: number
}

interface CheckinSiteConfig {
  id: string
  name: string
  siteUrl: string
  cookie: string
  userId: number
}

const MAX_SITE_URL_LEN = 256
const MAX_COOKIE_LEN = 16_384

interface CheckinConfigData {
  activeSiteId: string | null
  sites: CheckinSiteConfig[]
}

interface CheckinConfigResponse {
  success: boolean
  data?: CheckinConfigData
  path?: string
  message?: string
}

type CheckinState = 'idle' | 'verifying' | 'checking-in' | 'loading-status'

function getSiteDisplayName(site: CheckinSiteConfig): string {
  return site.name || site.siteUrl.replace(/^https?:\/\//, '') || '未命名站点'
}

// ─── Main Component ─────────────────────────────────────────────
export default function CheckinPanel() {
  const [siteUrl, setSiteUrl] = useState('https://example.com')
  const [cookie, setCookie] = useState('')
  const [userIdInput, setUserIdInput] = useState('')

  const [configPath, setConfigPath] = useState('~/.cliproxy-dashboard/register.yaml')
  const [sites, setSites] = useState<CheckinSiteConfig[]>([])
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  const [state, setState] = useState<CheckinState>('idle')
  const [session, setSession] = useState<SessionData | null>(null)
  const [stats, setStats] = useState<CheckinStats | null>(null)
  const [logs, setLogs] = useState<CheckinLogItem[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [lastCheckinReward, setLastCheckinReward] = useState<number | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  const currentSite = sites.find((site) => site.id === activeSiteId) ?? null

  const applySite = useCallback((site: CheckinSiteConfig | null) => {
    if (!site) {
      setSiteUrl('https://example.com')
      setCookie('')
      setUserIdInput('')
      return
    }

    setSiteUrl(site.siteUrl || 'https://example.com')
    setCookie(site.cookie || '')
    setUserIdInput(site.userId ? String(site.userId) : '')
  }, [])

  const loadConfig = useCallback(async () => {
    setConfigLoading(true)
    try {
      const res = await fetch('/api/checkin/config')
      const data = await res.json() as CheckinConfigResponse

      if (!data.success || !data.data) {
        setMessage({ type: 'error', text: data.message || '读取签到配置失败' })
        setConfigLoading(false)
        return
      }

      setConfigPath(data.path || '~/.cliproxy-dashboard/register.yaml')
      setSites(data.data.sites)
      setActiveSiteId(data.data.activeSiteId)
      const active = data.data.sites.find((site) => site.id === data.data?.activeSiteId) ?? data.data.sites[0] ?? null
      applySite(active)
    } catch (err) {
      setMessage({ type: 'error', text: `读取签到配置失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setConfigLoading(false)
    }
  }, [applySite])

  const saveConfig = useCallback(async (nextSites: CheckinSiteConfig[], nextActiveSiteId: string | null) => {
    const res = await fetch('/api/checkin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sites: nextSites, activeSiteId: nextActiveSiteId }),
    })

    const data = await res.json() as CheckinConfigResponse
    if (!data.success || !data.data) {
      throw new Error(data.message || '保存签到配置失败')
    }

    setConfigPath(data.path || configPath)
    setSites(data.data.sites)
    setActiveSiteId(data.data.activeSiteId)
    return data.data
  }, [configPath])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  // ── Fetch checkin status ──
  const fetchStatus = useCallback(async (url: string, ck: string, uid: number) => {
    try {
      const res = await fetch('/api/checkin/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: url, cookie: ck, userId: uid }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setStats(data.data)
      } else {
        setStats(null)
      }
    } catch {
      // ignore
    }
  }, [])

  // ── Fetch topup logs (type=1, includes checkin rewards) ──
  const fetchLogs = useCallback(async (url: string, ck: string, uid: number) => {
    try {
      const res = await fetch('/api/checkin/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: url, cookie: ck, userId: uid }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        const items: CheckinLogItem[] = (data.data.items ?? data.data ?? [])
          .filter((item: { content?: string }) =>
            typeof item.content === 'string' && item.content.includes('签到')
          )
          .slice(0, 10)
        setLogs(items)
      }
    } catch {
      // ignore
    }
  }, [])

  // ── Verify session ──
  const handleVerify = useCallback(async () => {
    if (!siteUrl || !cookie) {
      setMessage({ type: 'error', text: '请填写站点地址和 Cookie' })
      return
    }

    setState('verifying')
    setMessage(null)
    setStats(null)
    setLogs([])
    setLastCheckinReward(null)

    const uid = Number(userIdInput) || 0

    try {
      const res = await fetch('/api/checkin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl, cookie, userId: uid }),
      })
      const data = await res.json()

      if (!data.success) {
        if (data.needsUserId && !uid) {
          setMessage({ type: 'info', text: '该站点需要 User ID，请填写后重试' })
        } else {
          setMessage({ type: 'error', text: data.message || '验证失败，Cookie 可能已过期' })
        }
        setState('idle')
        return
      }

      const sessionData: SessionData = {
        userId: data.data.userId,
        username: data.data.username,
        quota: data.data.quota ?? 0,
        usedQuota: data.data.usedQuota ?? 0,
        requestCount: data.data.requestCount ?? 0,
      }
      setSession(sessionData)
      setUserIdInput(String(sessionData.userId))

      const displayName = getSiteDisplayName({
        id: currentSite?.id ?? '',
        name: currentSite?.name ?? '',
        siteUrl,
        cookie,
        userId: sessionData.userId,
      })

      let nextActiveId = activeSiteId
      let nextSites = [...sites]

      if (currentSite) {
        nextSites = sites.map((site) =>
          site.id === currentSite.id
            ? {
                ...site,
                name: displayName,
                siteUrl,
                cookie,
                userId: sessionData.userId,
              }
            : site
        )
      } else {
        nextActiveId = `site-${Date.now()}`
        nextSites = [
          ...sites,
          {
            id: nextActiveId,
            name: displayName,
            siteUrl,
            cookie,
            userId: sessionData.userId,
          },
        ]
      }

      const savedConfig = await saveConfig(nextSites, nextActiveId)
      const savedActive = savedConfig.sites.find((site) => site.id === savedConfig.activeSiteId) ?? null
      applySite(savedActive)

      setMessage({ type: 'success', text: `验证成功: ${sessionData.username}` })

      setState('loading-status')
      await Promise.all([
        fetchStatus(siteUrl, cookie, sessionData.userId),
        fetchLogs(siteUrl, cookie, sessionData.userId),
      ])
      setState('idle')
    } catch (err) {
      setMessage({ type: 'error', text: `请求失败: ${err instanceof Error ? err.message : String(err)}` })
      setState('idle')
    }
  }, [
    siteUrl,
    cookie,
    userIdInput,
    activeSiteId,
    currentSite,
    sites,
    fetchStatus,
    fetchLogs,
    saveConfig,
    applySite,
  ])

  // ── Do checkin ──
  const handleCheckin = useCallback(async () => {
    if (!session) return

    setState('checking-in')
    setMessage(null)
    setLastCheckinReward(null)

    try {
      const res = await fetch('/api/checkin/do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl, cookie, userId: session.userId }),
      })
      const data = await res.json()

      if (data.success) {
        const reward = data.data?.quota_awarded ?? 0
        setLastCheckinReward(reward)
        setMessage({ type: 'success', text: `签到成功！获得 ${formatUSD(reward)} 额度` })

        // Update balance if returned
        if (data.balance) {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  quota: data.balance.quota,
                  usedQuota: data.balance.usedQuota,
                  requestCount: data.balance.requestCount ?? prev.requestCount,
                }
              : prev
          )
        }

        setState('loading-status')
        await Promise.all([
          fetchStatus(siteUrl, cookie, session.userId),
          fetchLogs(siteUrl, cookie, session.userId),
        ])
      } else {
        setMessage({ type: 'error', text: data.message || '签到失败' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: `请求失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setState('idle')
    }
  }, [session, siteUrl, cookie, fetchStatus, fetchLogs])

  const handleDisconnect = () => {
    setSession(null)
    setStats(null)
    setLogs([])
    setMessage(null)
    setLastCheckinReward(null)
  }

  const handleSelectSite = useCallback((siteId: string) => {
    if (siteId === activeSiteId) return

    const site = sites.find((item) => item.id === siteId) ?? null
    if (!site) return

    setSession(null)
    setStats(null)
    setLogs([])
    setLastCheckinReward(null)
    setMessage(null)

    void saveConfig(sites, site.id)
      .then((saved) => {
        const active = saved.sites.find((item) => item.id === saved.activeSiteId) ?? null
        applySite(active)
      })
      .catch((err) => {
        setMessage({ type: 'error', text: `切换站点失败: ${err instanceof Error ? err.message : String(err)}` })
      })
  }, [activeSiteId, sites, applySite, saveConfig])

  const handleAddSite = useCallback(async () => {
    if (!siteUrl || !cookie) {
      setMessage({ type: 'error', text: '请先填写站点地址和 Cookie' })
      return
    }

    if (sites.some((site) => site.siteUrl === siteUrl && site.id !== activeSiteId)) {
      setMessage({ type: 'info', text: '该站点已存在，可直接在上方切换' })
      return
    }

    setState('verifying')
    setMessage(null)

    const userId = Number(userIdInput) || 0

    try {
      const res = await fetch('/api/checkin/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: siteUrl.replace(/^https?:\/\//, ''),
          siteUrl,
          cookie,
          userId,
        }),
      })

      const data = await res.json() as CheckinConfigResponse
      if (!data.success || !data.data) {
        setMessage({ type: 'error', text: data.message || '新增站点失败' })
        return
      }

      setConfigPath(data.path || configPath)
      setSites(data.data.sites)
      setActiveSiteId(data.data.activeSiteId)
      const active = data.data.sites.find((site) => site.id === data.data?.activeSiteId) ?? null
      applySite(active)
      setSession(null)
      setStats(null)
      setLogs([])
      setLastCheckinReward(null)
      setMessage({ type: 'success', text: '已新增签到站点，请点击“验证并连接”完成校验' })
    } catch (err) {
      setMessage({ type: 'error', text: `新增站点失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setState('idle')
    }
  }, [siteUrl, cookie, userIdInput, activeSiteId, configPath, sites, applySite])

  const handleDeleteSite = useCallback(async () => {
    if (!activeSiteId) return

    setState('verifying')
    setMessage(null)

    try {
      const res = await fetch(`/api/checkin/sites/${encodeURIComponent(activeSiteId)}`, {
        method: 'DELETE',
      })
      const data = await res.json() as CheckinConfigResponse

      if (!data.success || !data.data) {
        setMessage({ type: 'error', text: data.message || '删除站点失败' })
        return
      }

      setConfigPath(data.path || configPath)
      setSites(data.data.sites)
      setActiveSiteId(data.data.activeSiteId)
      const active = data.data.sites.find((site) => site.id === data.data?.activeSiteId) ?? null
      applySite(active)
      setSession(null)
      setStats(null)
      setLogs([])
      setLastCheckinReward(null)
      setMessage({ type: 'success', text: '站点已删除' })
    } catch (err) {
      setMessage({ type: 'error', text: `删除站点失败: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setState('idle')
    }
  }, [activeSiteId, configPath, applySite])

  const checkedInToday = stats?.stats?.checked_in_today ?? false
  const isLoading = state !== 'idle'

  return (
    <div className="space-y-4 mt-4">
      {/* ─── Config Card ─── */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <span className="text-sm font-medium text-ink">每日签到</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGuide((v) => !v)}
              className="text-xs text-subtle hover:text-coral transition-colors"
            >
              {showGuide ? '收起教程' : '如何获取 Cookie？'}
            </button>
            {session && (
              <button
                onClick={handleDisconnect}
                className="text-xs text-subtle hover:text-coral transition-colors"
              >
                断开
              </button>
            )}
          </div>
        </div>

        {showGuide && (
          <div className="px-4 py-3 bg-canvas border-b border-border text-xs text-subtle space-y-1.5">
            <p className="font-medium text-ink">获取 Cookie 步骤：</p>
            <ol className="list-decimal list-inside space-y-1 pl-1">
              <li>在浏览器中打开目标站点并登录（如通过 LinuxDO OAuth）</li>
              <li>按 <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[10px]">F12</kbd> 打开开发者工具</li>
              <li>切换到 <span className="font-medium text-ink">Network</span>（网络）标签页</li>
              <li>刷新页面，在请求列表中找到任意一个请求</li>
              <li>点击该请求 → <span className="font-medium text-ink">Headers</span> → 找到 <span className="font-medium text-ink">Cookie</span> 请求头</li>
              <li>复制整个 Cookie 值粘贴到下方输入框</li>
            </ol>
            <p className="text-muted mt-1">User ID 会在验证时自动获取，通常不需要手动填写。</p>
          </div>
        )}

        <div className="p-4 space-y-3">
          <div className="text-[11px] text-subtle break-all">配置文件：{configPath}</div>

          {configLoading ? (
            <div className="text-xs text-subtle flex items-center gap-1">
              <Spinner />
              读取配置中...
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-subtle mb-1">签到站点</label>
                <div className="flex items-center gap-2">
                  <select
                    value={activeSiteId ?? ''}
                    onChange={(e) => handleSelectSite(e.target.value)}
                    disabled={isLoading || sites.length === 0}
                    className="flex-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded text-ink disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coral/50"
                  >
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {getSiteDisplayName(site)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleDeleteSite}
                    disabled={isLoading || !activeSiteId || sites.length <= 1}
                    className="px-3 py-1.5 text-xs font-medium rounded border border-border text-subtle hover:text-ink hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-subtle mb-1">站点地址</label>
                <input
                  type="url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value.slice(0, MAX_SITE_URL_LEN))}
                  placeholder="https://example.com"
                  disabled={!!session}
                  maxLength={MAX_SITE_URL_LEN}
                  className="w-full px-3 py-1.5 text-sm bg-canvas border border-border rounded text-ink placeholder:text-muted disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coral/50"
                />
              </div>

              <div>
                <label className="block text-xs text-subtle mb-1">Cookie</label>
                <textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value.slice(0, MAX_COOKIE_LEN))}
                  placeholder="session=abc123; _ga=GA1.2..."
                  disabled={!!session}
                  rows={2}
                  maxLength={MAX_COOKIE_LEN}
                  className="w-full px-3 py-1.5 text-sm bg-canvas border border-border rounded text-ink placeholder:text-muted disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coral/50 resize-none font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs text-subtle mb-1">
                  User ID <span className="text-muted">（可选，验证时自动获取）</span>
                </label>
                <input
                  type="text"
                  value={userIdInput}
                  onChange={(e) => setUserIdInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="自动获取"
                  disabled={!!session}
                  className="w-full px-3 py-1.5 text-sm bg-canvas border border-border rounded text-ink placeholder:text-muted disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-coral/50"
                />
              </div>

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                {!session ? (
                  <button
                    onClick={handleVerify}
                    disabled={isLoading || !siteUrl || !cookie}
                    className="px-4 py-1.5 text-sm font-medium rounded bg-coral text-white hover:bg-coral/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    {state === 'verifying' ? (
                      <>
                        <Spinner />
                        验证中...
                      </>
                    ) : (
                      '验证并连接'
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleCheckin}
                    disabled={isLoading || checkedInToday}
                    className={`px-4 py-1.5 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
                      checkedInToday
                        ? 'bg-green-600/20 text-green-400 cursor-default'
                        : 'bg-coral text-white hover:bg-coral/90 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    {state === 'checking-in' ? (
                      <>
                        <Spinner />
                        签到中...
                      </>
                    ) : checkedInToday ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        今日已签到
                      </>
                    ) : (
                      '立即签到'
                    )}
                  </button>
                )}

                <button
                  onClick={handleAddSite}
                  disabled={isLoading || !siteUrl || !cookie || sites.some((site) => site.siteUrl === siteUrl && site.id !== activeSiteId)}
                  className="px-3 py-1.5 text-xs font-medium rounded border border-border text-subtle hover:text-ink hover:bg-canvas disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  新增站点
                </button>

                {session && state === 'loading-status' && (
                  <span className="text-xs text-subtle flex items-center gap-1">
                    <Spinner />
                    加载状态...
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Message ─── */}
      {message && (
        <div
          className={`px-4 py-2.5 rounded-lg text-sm border ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/20 text-green-400'
              : message.type === 'error'
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ─── Reward Card (after checkin) ─── */}
      {lastCheckinReward !== null && lastCheckinReward > 0 && (
        <div className="relative overflow-hidden rounded-lg border border-coral/20 bg-gradient-to-br from-coral/5 via-amber-500/5 to-green-500/5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(201,100,66,0.08),transparent_60%)]" />
          <div className="relative px-5 py-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-coral to-amber-500 flex items-center justify-center shadow-lg shadow-coral/20">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-subtle mb-0.5">🎉 今日签到奖励</div>
              <div className="text-2xl font-bold text-coral tracking-tight">
                {formatUSD(lastCheckinReward)}
              </div>
              <div className="text-xs text-muted mt-0.5">
                额度已自动充入账户余额
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Account Balance Card ─── */}
      {session && (
        <div className="relative overflow-hidden rounded-lg border border-border">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-indigo-500/5 to-purple-500/10" />
          <div className="relative px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-coral/15 flex items-center justify-center text-coral text-sm font-bold">
                  {session.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-ink">{session.username}</div>
                  <div className="text-[10px] text-muted">ID: {session.userId}</div>
                </div>
              </div>
              <div className="text-[10px] text-muted px-1.5 py-0.5 rounded bg-surface/50 border border-border">
                {siteUrl.replace(/^https?:\/\//, '')}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface/60 backdrop-blur-sm rounded-lg px-3 py-2.5 border border-border/50">
                <div className="text-[10px] text-muted mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                  </svg>
                  当前余额
                </div>
                <div className="text-base font-bold text-ink tabular-nums">{formatUSD(session.quota)}</div>
              </div>
              <div className="bg-surface/60 backdrop-blur-sm rounded-lg px-3 py-2.5 border border-border/50">
                <div className="text-[10px] text-muted mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  历史消耗
                </div>
                <div className="text-base font-bold text-ink tabular-nums">{formatUSD(session.usedQuota)}</div>
              </div>
              <div className="bg-surface/60 backdrop-blur-sm rounded-lg px-3 py-2.5 border border-border/50">
                <div className="text-[10px] text-muted mb-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                  </svg>
                  请求次数
                </div>
                <div className="text-base font-bold text-ink tabular-nums">{session.requestCount.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Stats Card ─── */}
      {stats && session && stats.stats && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-medium text-ink">签到统计</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <MetricCard
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.047 8.287 8.287 0 009 9.601a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                  </svg>
                }
                label="连续签到"
                value={`${stats.stats.continuous_days ?? 0}`}
                unit="天"
                accent="text-amber-400"
              />
              <MetricCard
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                label="累计签到"
                value={`${stats.stats.total_checkins ?? 0}`}
                unit="次"
                accent="text-green-400"
              />
              <MetricCard
                icon={
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                label="奖励范围"
                value={`${formatUSD(stats.min_quota ?? 0)} ~ ${formatUSD(stats.max_quota ?? 0)}`}
                accent="text-coral"
              />
            </div>
            <CheckinCalendar dates={stats.stats.checkin_dates ?? []} />
          </div>
        </div>
      )}

      {/* ─── Recent Checkin Logs ─── */}
      {logs.length > 0 && session && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-medium text-ink">签到记录</span>
          </div>
          <div className="divide-y divide-border">
            {logs.map((log) => {
              const date = new Date(log.created_at * 1000)
              return (
                <div key={log.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-ink truncate">{log.content}</div>
                      <div className="text-[10px] text-muted">
                        {date.toLocaleDateString('zh-CN')} {date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-green-400 flex-shrink-0 ml-3 tabular-nums">
                    +{formatUSD(log.quota)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-Components ─────────────────────────────────────────────

function MetricCard({
  icon,
  label,
  value,
  unit,
  accent = 'text-ink',
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  accent?: string
}) {
  return (
    <div className="bg-canvas rounded-lg px-3 py-2.5">
      <div className={`flex items-center gap-1 text-[10px] mb-1 ${accent}`}>
        {icon}
        <span className="text-muted">{label}</span>
      </div>
      <div className="text-sm font-bold text-ink">
        {value}
        {unit && <span className="text-xs font-normal text-subtle ml-0.5">{unit}</span>}
      </div>
    </div>
  )
}

function CheckinCalendar({ dates }: { dates: string[] }) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = now.getDate()

  const dateSet = new Set(dates.map((d) => parseInt(d.split('-')[2], 10)))

  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div>
      <div className="text-xs text-subtle mb-2">{year}年{month + 1}月</div>
      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((w) => (
          <div key={w} className="text-center text-[10px] text-muted py-0.5">{w}</div>
        ))}
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e-${idx}`} />
          const checked = dateSet.has(day)
          const isToday = day === today
          return (
            <div
              key={day}
              className={`text-center text-xs py-1 rounded ${
                checked ? 'bg-coral/20 text-coral font-medium' : 'text-subtle'
              } ${isToday && !checked ? 'ring-1 ring-coral/40' : ''}`}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}