import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Check, ChevronDown, CircleDot, GitCommitHorizontal, GitPullRequest, Loader2, MessageSquare,
  RotateCcw, Send, Sparkles, Tag, X, Minus, ExternalLink,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { retryEvent, type EventAction, type EventItem, type EventStatus } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { duration, fullTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

const TYPE_ICON = { issues: CircleDot, pull_request: GitPullRequest, push: GitCommitHorizontal } as const
const TYPE_LABEL = { issues: 'Issue', pull_request: 'Pull request', push: 'Push' } as const

const ACTION_META: Record<string, { label: string; icon: typeof Tag }> = {
  add_label: { label: 'Added label', icon: Tag },
  add_ai_label: { label: 'Added AI label', icon: Sparkles },
  comment: { label: 'Posted comment', icon: MessageSquare },
  slack: { label: 'Sent Slack alert', icon: Send },
  ai_triage: { label: 'AI triage', icon: Sparkles },
}

function StatusBadge({ status }: { status: EventStatus }) {
  switch (status) {
    case 'done': return <Badge variant="success"><Check /> Done</Badge>
    case 'pending': return <Badge variant="secondary"><Loader2 className="animate-spin" /> Queued</Badge>
    case 'processing': return <Badge variant="secondary"><Loader2 className="animate-spin" /> Processing</Badge>
    case 'failed': return <Badge variant="warning"><AlertTriangle /> Retrying</Badge>
    case 'dead': return <Badge variant="destructive"><X /> Failed</Badge>
  }
}

const PRIORITY_VARIANT = { low: 'secondary', medium: 'warning', high: 'destructive', critical: 'destructive' } as const

function ActionIcon({ status }: { status: EventAction['status'] }) {
  if (status === 'success') return <Check className="size-4 text-success" />
  if (status === 'failed') return <X className="size-4 text-destructive" />
  return <Minus className="size-4 text-muted-foreground" />
}

/** One short line of what an action did, taken from its recorded detail. */
function actionSummary(a: EventAction): ReactNode {
  const d = a.detail ?? {}
  if (a.type === 'add_label' || a.type === 'add_ai_label') return d.label ? <>“{String(d.label)}”</> : null
  if (a.type === 'ai_triage') return d.priority ? <>priority {String(d.priority)}</> : null
  if (a.type === 'comment' && typeof d.url === 'string') {
    return <a href={d.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">view <ExternalLink className="size-3" /></a>
  }
  if (a.type === 'comment' && d.alreadyPosted) return <>already posted</>
  if (a.status === 'skipped' && typeof d.reason === 'string') return <>{d.reason}</>
  return null
}

export default function EventCard({ ev }: { ev: EventItem }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const TypeIcon = TYPE_ICON[ev.eventType]
  const number = ev.eventType !== 'push' ? ev.url?.match(/\/(\d+)$/)?.[1] : null

  const retry = useMutation({
    mutationFn: () => retryEvent(ev.id),
    onSuccess: () => {
      toast.success('Retry queued')
      void qc.invalidateQueries({ queryKey: ['events'] })
      void qc.invalidateQueries({ queryKey: ['stats'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const chips = ev.actions.filter((a) => a.type !== 'ai_triage')
  const canRetry = ev.status === 'failed' || ev.status === 'dead'

  return (
    <li className="rounded-xl border bg-card">
      <button
        type="button"
        className="flex w-full items-start gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <TypeIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label={TYPE_LABEL[ev.eventType]} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{ev.title}</span>
            <StatusBadge status={ev.status} />
            {ev.ai && <Badge variant={PRIORITY_VARIANT[ev.ai.priority]}><Sparkles /> {ev.ai.priority}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>{ev.repo}{number ? ` #${number}` : ''}</span>
            <span>·</span>
            <span>{TYPE_LABEL[ev.eventType]}{ev.action ? ` ${ev.action.replace('_', ' ')}` : ''} by {ev.author}</span>
            <span>·</span>
            <time dateTime={ev.receivedAt} title={fullTime(ev.receivedAt)}>{timeAgo(ev.receivedAt)}</time>
          </div>
          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((a) => {
                const meta = ACTION_META[a.type] ?? { label: a.type, icon: Tag }
                const Icon = meta.icon
                return (
                  <span
                    key={a.id}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                      a.status === 'success' && 'border-success/30 text-success',
                      a.status === 'failed' && 'border-destructive/40 text-destructive',
                      a.status === 'skipped' && 'text-muted-foreground',
                    )}
                  >
                    <Icon className="size-3" /> {meta.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <ChevronDown className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4 text-sm">
          {ev.ai && (
            <div className="rounded-lg bg-muted p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="size-3" /> AI triage</div>
              <p>{ev.ai.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Priority: <strong>{ev.ai.priority}</strong> · Suggested label: <strong>{ev.ai.label ?? 'none'}</strong>
              </p>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">What the bot did</div>
            {ev.actions.length === 0 ? (
              <p className="text-muted-foreground">
                {ev.status === 'done' ? 'No rule matched this event, so nothing was done.' : 'Waiting to be processed.'}
              </p>
            ) : (
              <ol className="space-y-2">
                {ev.actions.map((a) => (
                  <li key={a.id} className="flex items-start gap-2">
                    <span className="mt-0.5"><ActionIcon status={a.status} /></span>
                    <div className="min-w-0">
                      <div>
                        {(ACTION_META[a.type]?.label ?? a.type)} {actionSummary(a)}
                        <span className="text-muted-foreground">
                          {a.ruleName ? ` · rule “${a.ruleName}”` : ''}{a.attempt > 1 ? ` · attempt ${a.attempt}` : ''}
                        </span>
                      </div>
                      {a.error && <div className="break-words text-xs text-destructive">{a.error}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {ev.lastError && ev.status !== 'done' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive break-words">{ev.lastError}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Received {fullTime(ev.receivedAt)}
              {ev.processedAt && ` · handled in ${duration(ev.receivedAt, ev.processedAt)}`}
              {ev.attempts > 1 && ` · ${ev.attempts} attempts`}
              {ev.status === 'failed' && ` · next retry ${timeAgo(ev.nextAttemptAt).replace(' ago', '')} (scheduled ${fullTime(ev.nextAttemptAt)})`}
            </span>
            <span className="flex gap-2">
              {ev.url && (
                <Button asChild variant="outline" size="sm">
                  <a href={ev.url} target="_blank" rel="noreferrer noopener"><ExternalLink /> Open on GitHub</a>
                </Button>
              )}
              {canRetry && (
                <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate()}>
                  {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
                </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </li>
  )
}
