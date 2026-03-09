import { useEffect, useState } from 'react'
import { useCredStore } from '@/store/credStore'
import { useConnection } from '@/hooks/useConnection'
import Layout from '@/components/layout/Layout'
import Header from '@/components/layout/Header'
import ConnectionPanel from '@/components/connection/ConnectionPanel'
import CredentialTabs from '@/components/credentials/CredentialTabs'
import BulkActionBar from '@/components/bulk/BulkActionBar'
import UsagePanel from '@/components/usage/UsagePanel'
import RegisterPanel from '@/components/register/RegisterPanel'
import CheckinPanel from '@/components/checkin/CheckinPanel'
import SettingsPanel from '@/components/settings/SettingsPanel'

type ActiveView = 'credentials' | 'usage' | 'register' | 'checkin' | 'settings'

export default function App() {
  const { reconnectFromStorage } = useConnection()
  const connected = useCredStore((s) => s.connected)
  const [activeView, setActiveView] = useState<ActiveView>('credentials')

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

          {activeView === 'credentials' && <CredentialTabs />}
          {activeView === 'usage' && <UsagePanel />}
          {activeView === 'register' && <RegisterPanel />}
          {activeView === 'checkin' && <CheckinPanel />}
          {activeView === 'settings' && <SettingsPanel />}
        </>
      )}

      <BulkActionBar />
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
      key: 'register',
      label: '注册机',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      key: 'checkin',
      label: '签到',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
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
