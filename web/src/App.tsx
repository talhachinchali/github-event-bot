import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity as ActivityIcon, Bot, GitBranch, ListChecks, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { logout, fetchMe, setCsrfToken, UnauthenticatedError, type Me } from './api'
import Landing from './components/Landing'
import ThemeToggle from './components/ThemeToggle'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import Activity from './features/activity/Activity'
import Repos from './features/repos/Repos'
import Rules from './features/rules/Rules'
import SettingsPanel from './features/settings/Settings'

const TABS = ['activity', 'rules', 'repos', 'settings'] as const
type Tab = (typeof TABS)[number]
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#', '')
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'activity'
}

export default function App() {
  const qc = useQueryClient()
  const loginFailed = new URLSearchParams(window.location.search).get('error') === 'login_failed'

  // `null` = not signed in. A 401 anywhere also sets this to null (see lib/queryClient.ts).
  const me = useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: () => fetchMe().catch((e) => (e instanceof UnauthenticatedError ? null : Promise.reject(e))),
    staleTime: 5 * 60_000,
    retry: false,
  })

  useEffect(() => { if (me.data) setCsrfToken(me.data.csrfToken) }, [me.data])

  // `data` is checked first: a failed background refetch must not replace a working dashboard with an error page.
  if (me.data) {
    return <Dashboard me={me.data} onSignOut={async () => { await logout().catch(() => undefined); qc.clear(); qc.setQueryData(['me'], null) }} />
  }
  if (me.isPending) return <div className="mx-auto max-w-5xl space-y-4 p-8"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>
  if (me.isError) return <p role="alert" className="p-8 text-destructive">Something went wrong: {me.error.message}</p>
  return <Landing loginFailed={loginFailed} />
}

function Dashboard({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-semibold"><Bot className="size-5" /> Repo Sentinel</div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {me.user.avatarUrl && <img src={me.user.avatarUrl} alt="" width={28} height={28} className="rounded-full" />}
            <span className="hidden text-sm sm:inline">{me.user.login}</span>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={onSignOut}><LogOut /></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => { window.location.hash = v }}>
          <TabsList>
            <TabsTrigger value="activity"><ActivityIcon /> Activity</TabsTrigger>
            <TabsTrigger value="rules"><ListChecks /> Rules</TabsTrigger>
            <TabsTrigger value="repos"><GitBranch /> Repositories</TabsTrigger>
            <TabsTrigger value="settings"><SettingsIcon /> Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="activity"><Activity /></TabsContent>
          <TabsContent value="rules"><Rules /></TabsContent>
          <TabsContent value="repos"><Repos installUrl={me.installUrl} /></TabsContent>
          <TabsContent value="settings"><SettingsPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
