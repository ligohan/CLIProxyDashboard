import { useEffect, useState } from 'react'
import { useCredStore } from '@/store/credStore'
import { useConnection } from '@/hooks/useConnection'
import { applyThemeMode, loadThemeMode, saveThemeMode, type ThemeMode } from '@/lib/theme'

export default function Header() {
  const connected = useCredStore((s) => s.connected)
  const connection = useCredStore((s) => s.connection)
  const { disconnect } = useConnection()
  const [theme, setTheme] = useState<ThemeMode>(() => loadThemeMode())
  const [keyVisible, setKeyVisible] = useState(false)

  useEffect(() => {
    applyThemeMode(theme)
    saveThemeMode(theme)
  }, [theme])

  return (
    <div className="border-b border-border pb-4">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Title + connection status */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-2 h-2 rounded-sm bg-coral" />
          <h1 className="font-serif text-2xl text-ink font-normal tracking-tight">
            CLIProxy Dashboard
          </h1>
        </div>

        {/* Center: Endpoint + Key (when connected) */}
        {connected && connection && (
          <div className="flex items-center gap-3 text-sm min-w-0">
            <span className="text-subtle flex-shrink-0">端点</span>
            <span className="font-mono-key text-ink truncate">{connection.endpoint}</span>
            <span className="text-border flex-shrink-0">·</span>
            <span className="text-subtle flex-shrink-0">密钥</span>
            <button
              onClick={() => setKeyVisible((v) => !v)}
              className="flex items-center gap-1.5 font-mono-key text-ink tracking-widest hover:text-coral transition-colors flex-shrink-0"
              title={keyVisible ? '隐藏密钥' : '显示密钥'}
            >
              {keyVisible ? connection.managementKey : '••••••••'}
              <svg className="w-3 h-3 text-subtle flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {keyVisible
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  : <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></>
                }
              </svg>
            </button>
          </div>
        )}

        {/* Right: Theme toggle + connection status / disconnect */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            className="inline-flex items-center justify-center w-8 h-8 rounded border border-border bg-surface text-subtle shadow-sm hover:text-ink hover:bg-canvas transition-colors"
            title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
            aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {connected ? (
            <button
              onClick={disconnect}
              className="text-xs font-medium text-subtle border border-border rounded px-2.5 py-1 hover:border-ink hover:text-ink transition-colors"
            >
              断开连接
            </button>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-muted" />
              <span className="text-sm text-subtle">未连接</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SunIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25M12 18.75V21m8.25-9H21M3 12h2.25m12.364 6.364l1.591 1.591M4.795 4.795l1.591 1.591m10.228-1.591l-1.591 1.591M6.386 17.614l-1.591 1.591M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3a7.5 7.5 0 009.79 9.79z" />
    </svg>
  )
}
