import { useState, useEffect } from 'react'
import { useCredStore } from '@/store/credStore'
import { useConnection } from '@/hooks/useConnection'
import type { ConnectionConfig } from '@/types/api'

export default function ConnectionPanel() {
  const canUseDevProxy = import.meta.env.DEV
  const connected = useCredStore((s) => s.connected)
  const connection = useCredStore((s) => s.connection)
  const { connect, error, isConnecting } = useConnection()

  const [endpoint, setEndpoint] = useState('')
  const [managementKey, setManagementKey] = useState('')
  const [useProxy, setUseProxy] = useState(false)

  useEffect(() => {
    if (connection) {
      setEndpoint(connection.endpoint)
      setManagementKey(connection.managementKey)
      setUseProxy(canUseDevProxy ? connection.useProxy : false)
    }
  }, [connection, canUseDevProxy])

  async function handleConnect() {
    const config: ConnectionConfig = {
      endpoint: endpoint.trim(),
      managementKey: managementKey.trim(),
      useProxy: canUseDevProxy ? useProxy : false,
    }
    await connect(config)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleConnect()
  }

  if (connected) {
    return null
  }

  return (
    <div className="bg-surface border border-border rounded-lg shadow-card p-6">
      <h2 className="font-serif text-xl text-ink font-normal mb-1">
        连接到端点
      </h2>
      <p className="text-sm text-subtle mb-5">
        输入 CLIProxyAPI 的端点地址和管理密钥以开始使用。
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            端点地址
          </label>
          <input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="http://localhost:8317"
            className="w-full px-3 py-2 bg-canvas border border-border rounded text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-coral focus:border-coral transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            管理密钥
          </label>
          <input
            type="password"
            value={managementKey}
            onChange={(e) => setManagementKey(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="your-management-key"
            className="w-full px-3 py-2 bg-canvas border border-border rounded text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-coral focus:border-coral transition-colors"
          />
        </div>

        {canUseDevProxy ? (
          <div className="flex items-start gap-2.5">
            <input
              id="use-proxy"
              type="checkbox"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
              className="mt-0.5 w-3.5 h-3.5 rounded border-border accent-coral"
            />
            <div>
              <label
                htmlFor="use-proxy"
                className="text-sm font-medium text-ink cursor-pointer"
              >
                使用 Vite 代理转发（仅本地开发）
              </label>
              <p className="text-2xs text-subtle mt-0.5">
                线上部署到 Cloudflare Pages 后无需此项。仅在本地开发模式下可用，需设置{' '}
                <code className="font-mono-key bg-border/50 px-1 rounded">
                  VITE_PROXY_MODE=true
                </code>{' '}
                并重启开发服务器。
              </p>
            </div>
          </div>
        ) : (
          <p className="text-2xs text-subtle">
            当前为线上环境：Vite 代理不会生效，请直接连接可跨域访问的管理端点，或使用同域反向代理。
          </p>
        )}

        {error && (
          <div className="px-3 py-2.5 bg-[#FCEAEA] border border-[#EBC4C4] rounded text-sm text-[#B94040]">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={isConnecting || !endpoint || !managementKey}
          className="w-full py-2 px-4 bg-coral text-white text-sm font-medium rounded hover:bg-coral-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isConnecting ? '连接中…' : '连接'}
        </button>
      </div>
    </div>
  )
}
