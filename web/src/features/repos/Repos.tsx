import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, Lock, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { connectRepo, disconnectRepo, fetchRepos, setRepoEnabled } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function Repos({ installUrl }: { installUrl: string }) {
  const qc = useQueryClient()
  const repos = useQuery({ queryKey: ['repos'], queryFn: fetchRepos })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['repos'] })
    void qc.invalidateQueries({ queryKey: ['connected-repos'] })
  }
  const done = (message: string) => () => { toast.success(message); refresh() }
  const failed = (e: Error) => toast.error(e.message)

  const connect = useMutation({ mutationFn: connectRepo, onSuccess: done('Repository connected'), onError: failed })
  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => setRepoEnabled(v.id, v.enabled),
    onSuccess: done('Updated'), onError: failed,
  })
  const remove = useMutation({ mutationFn: disconnectRepo, onSuccess: done('Repository disconnected'), onError: failed })

  if (repos.isPending) return <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
  if (repos.isError) return <p role="alert" className="text-sm text-destructive">Could not load repositories: {repos.error.message}</p>
  const { connected, available, installations } = repos.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Connected repositories</CardTitle>
          <CardDescription>The bot reacts to events from these repositories, using the rules you configure.</CardDescription>
        </CardHeader>
        <CardContent>
          {connected.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Connect one below.</p>
          ) : (
            <ul className="divide-y">
              {connected.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.fullName}</span>
                  <Badge variant={r.enabled ? 'success' : 'secondary'}>{r.enabled ? 'Active' : 'Paused'}</Badge>
                  <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}>
                    {r.enabled ? <Pause /> : <Play />} {r.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="outline" size="sm" className="text-destructive" disabled={remove.isPending}
                    onClick={() => { if (confirm(`Disconnect ${r.fullName}? Its rules and activity history will be deleted.`)) remove.mutate(r.id) }}
                  >
                    <Trash2 /> Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available repositories</CardTitle>
          <CardDescription>Repositories the GitHub App has been installed on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {installations.length === 0 ? (
            <p className="text-sm">
              The app isn't installed anywhere yet.{' '}
              <a className="underline" href={installUrl}>Install it on your repositories →</a>
            </p>
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every repository the app can see is already connected.</p>
          ) : (
            <ul className="divide-y">
              {available.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                  {r.private && <Badge variant="outline"><Lock /> Private</Badge>}
                  <Button
                    size="sm" disabled={!r.canConnect || connect.isPending}
                    title={r.canConnect ? undefined : 'You need admin access to connect this repository'}
                    onClick={() => connect.mutate({ installationId: r.installationId, repoId: r.id })}
                  >
                    {connect.isPending && connect.variables?.repoId === r.id && <Loader2 className="animate-spin" />} Connect
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="outline" size="sm"><a href={installUrl}><ExternalLink /> Add more repositories</a></Button>
            <Button variant="ghost" size="sm" disabled={repos.isFetching} onClick={refresh}>
              <RefreshCw className={repos.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
