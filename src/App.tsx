import { useEffect, useState } from 'react'
import { useCredStore } from '@/store/credStore'
import { useConnection } from '@/hooks/useConnection'
import Layout from '@/components/layout/Layout'
import Header from '@/components/layout/Header'
import ConnectionPanel from '@/components/connection/ConnectionPanel'
import CredentialTabs from '@/components/credentials/CredentialTabs'
import BulkActionBar from '@/components/bulk/BulkActionBar'
import UsagePanel from '@/components/usage/UsagePanel'
import SettingsPanel from '@/components/settings/SettingsPanel'
import { isCodexProviderName } from '@/utils/keyUtils'

type ActiveView = 'credentials' | 'usage' | 'settings'

export default function App() {
  const { reconnectFromStorage } = useConnection()
  const connected = useCredStore((s) => s.connected)
  const [activeView, setActiveView] = useState<ActiveView>('credentials')
  const [activeProvider, setActiveProvider] = useState('全部')

  const showCodexListActions =
    activeView === 'credentials'
    && activeProvider !== '全部'
    && isCodexProviderName(activeProvider)

  useEffect(() => {
    reconnectFromStorage()
  }, [])

  return (
    <Layout>
      <Header />
      <ConnectionPanel />

      {connected && (
        <>
          <ViewSwitcher activeView={activeView} onSwitch={setActiveView} />

          {activeView === 'credentials' && (
            <CredentialTabs
              activeProvider={activeProvider}
              onActiveProviderChange={setActiveProvider}
            />
          )}
          {activeView === 'usage' && <UsagePanel />}
          {activeView === 'settings' && <SettingsPanel />}
        </>
      )}

      <BulkActionBar showTestAction={showCodexListActions} />
    </Layout>
  )
}

function ViewSwitcher({
  activeView,
  onSwitch,
}: {
  activeView: ActiveView
  onSwitch: (view: ActiveView) => void
}) {
  const views: { key: ActiveView; label: string; icon: React.ReactNode }[] = [
    {
      key: 'credentials',
      label: '账号',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      ),
    },
    {
      key: 'usage',
      label: '使用统计',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      ),
    },
    {
      key: 'settings',
      label: '设置',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 12h9.75M10.5 18h9.75M3.75 6h.008v.008H3.75V6zM3.75 12h.008v.008H3.75V12zM3.75 18h.008v.008H3.75V18z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1 w-fit">
      {views.map(({ key, label, icon }) => (
        <button
          key={key}
          onClick={() => onSwitch(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            activeView === key
              ? 'bg-coral text-white shadow-sm'
              : 'text-subtle hover:text-ink hover:bg-border/30'
          }`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}
