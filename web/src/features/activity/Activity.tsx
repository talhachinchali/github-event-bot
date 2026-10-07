import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Inbox, ListTodo, Loader2, Radio } from 'lucide-react'
import { useState } from 'react'
import { fetchConnectedRepos, fetchEvents, fetchStats, type EventStatus, type EventType, type Stats } from '@/api'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import EventCard from './EventCard'
import { useLiveUpdates } from './useLiveUpdates'

const ALL = 'all'

function StatCards({ stats }: { stats: Stats | undefined }) {
  const items = [
    { label: 'Events', value: stats?.total, icon: Inbox, tone: '' },
    { label: 'Handled', value: stats?.done, icon: CheckCircle2, tone: 'text-success' },
    { label: 'Needs attention', value: stats ? stats.failed + stats.dead : undefined, icon: AlertTriangle, tone: 'text-destructive' },
    { label: 'In progress', value: stats ? stats.pending + stats.processing : undefined, icon: ListTodo, tone: 'text-muted-foreground' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(({ label, value, icon: Icon, tone }) => (
        <Card key={label} className="py-4">
          <CardContent className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? <Skeleton className="h-7 w-8" />}</div>
            </div>
            <Icon className={cn('size-5', tone)} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function Activity() {
  const live = useLiveUpdates()
  const [repo, setRepo] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [type, setType] = useState(ALL)

  const filters = {
    repoId: repo === ALL ? undefined : Number(repo),
    status: status === ALL ? undefined : (status as EventStatus),
    type: type === ALL ? undefined : (type as EventType),
  }
  const filtered = Boolean(filters.repoId || filters.status || filters.type)

  const repos = useQuery({ queryKey: ['connected-repos'], queryFn: fetchConnectedRepos })
  const stats = useQuery({ queryKey: ['stats', filters.repoId], queryFn: () => fetchStats(filters.repoId) })
  const events = useInfiniteQuery({
    queryKey: ['events', filters],
    queryFn: ({ pageParam }) => fetchEvents(filters, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = events.data?.pages.flatMap((p) => p.events) ?? []

  return (
    <div className="space-y-4">
      <StatCards stats={stats.data} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={repo} onValueChange={setRepo}>
          <SelectTrigger aria-label="Filter by repository" className="min-w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All repositories</SelectItem>
            {repos.data?.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.fullName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="failed">Retrying</SelectItem>
            <SelectItem value="dead">Failed</SelectItem>
            <SelectItem value="pending">Queued</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label="Filter by event type" className="min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any event</SelectItem>
            <SelectItem value="issues">Issues</SelectItem>
            <SelectItem value="pull_request">Pull requests</SelectItem>
            <SelectItem value="push">Pushes</SelectItem>
          </SelectContent>
        </Select>
        <span
          className={cn('ml-auto inline-flex items-center gap-1.5 text-xs', live ? 'text-success' : 'text-muted-foreground')}
          title={live ? 'Updates appear instantly' : 'Reconnecting…'}
        >
          <Radio className={cn('size-3.5', live && 'animate-pulse')} /> {live ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      {events.isPending ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : events.isError ? (
        <p role="alert" className="text-sm text-destructive">Could not load activity: {events.error.message}</p>
      ) : items.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <div className="font-medium">{filtered ? 'No events match these filters' : 'No activity yet'}</div>
          {!filtered && (
            <p className="max-w-sm text-sm text-muted-foreground">
              Connect a repository in <a className="underline" href="#repos">Repositories</a>, add a rule in <a className="underline" href="#rules">Rules</a>,
              then open an issue. Everything the bot does will show up here.
            </p>
          )}
        </Card>
      ) : (
        <>
          <ul className="space-y-2">{items.map((ev) => <EventCard key={ev.id} ev={ev} />)}</ul>
          {events.hasNextPage && (
            <div className="text-center">
              <Button variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
                {events.isFetchingNextPage && <Loader2 className="animate-spin" />} Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
