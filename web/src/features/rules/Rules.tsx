import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { deleteRule, fetchConnectedRepos, fetchRules, updateRule, type Rule, type RuleInput } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { describeRule } from '@/lib/rules'
import RuleDialog from './RuleDialog'

const asInput = (r: Rule, over: Partial<RuleInput> = {}): RuleInput => ({
  name: r.name, enabled: r.enabled, eventType: r.eventType, conditions: r.conditions, actions: r.actions, useAi: r.useAi, ...over,
})

export default function Rules() {
  const qc = useQueryClient()
  const repos = useQuery({ queryKey: ['connected-repos'], queryFn: fetchConnectedRepos })
  const [picked, setPicked] = useState<number | null>(null)
  const [dialog, setDialog] = useState<{ rule: Rule | null } | null>(null)

  // Derived, not stored: the picked repo if it still exists, otherwise the first connected one.
  const selected = repos.data?.find((r) => r.id === picked)?.id ?? repos.data?.[0]?.id ?? null

  const rules = useQuery({ queryKey: ['rules', selected], queryFn: () => fetchRules(selected!), enabled: selected !== null })
  const refresh = () => qc.invalidateQueries({ queryKey: ['rules', selected] })
  const failed = (e: Error) => toast.error(e.message)

  const toggle = useMutation({
    mutationFn: (r: Rule) => updateRule(selected!, r.id, asInput(r, { enabled: !r.enabled })),
    onSuccess: () => void refresh(), onError: failed,
  })
  const remove = useMutation({
    mutationFn: (r: Rule) => deleteRule(selected!, r.id),
    onSuccess: () => { toast.success('Rule deleted'); void refresh() }, onError: failed,
  })

  if (repos.isPending) return <Skeleton className="h-40 w-full" />
  if (repos.isError) return <p role="alert" className="text-sm text-destructive">Could not load repositories: {repos.error.message}</p>
  if (repos.data.length === 0) {
    return (
      <Card className="items-center py-12 text-center">
        <div className="font-medium">Connect a repository first</div>
        <p className="max-w-sm text-sm text-muted-foreground">Rules belong to a repository. Go to <a className="underline" href="#repos">Repositories</a> to connect one.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected === null ? undefined : String(selected)} onValueChange={(v) => setPicked(Number(v))}>
          <SelectTrigger aria-label="Repository" className="min-w-52"><SelectValue placeholder="Choose a repository" /></SelectTrigger>
          <SelectContent>{repos.data.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.fullName}</SelectItem>)}</SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => setDialog({ rule: null })}><Plus /> New rule</Button>
      </div>

      {rules.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : rules.isError ? (
        <p role="alert" className="text-sm text-destructive">Could not load rules: {rules.error.message}</p>
      ) : rules.data.length === 0 ? (
        <Card className="items-center py-12 text-center">
          <div className="font-medium">No rules yet</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Example: when an issue title contains “bug”, add the <code>bug</code> label and send a Slack alert.
          </p>
          <Button onClick={() => setDialog({ rule: null })}><Plus /> Create your first rule</Button>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rules.data.map((r) => (
            <li key={r.id} className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <Switch className="mt-1" checked={r.enabled} aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(r)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  {r.useAi && <Badge variant="secondary"><Sparkles /> AI</Badge>}
                  {!r.enabled && <Badge variant="outline">Disabled</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{describeRule(r)}</p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setDialog({ rule: r })}><Pencil /></Button>
              <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} className="text-destructive" disabled={remove.isPending}
                onClick={() => { if (confirm(`Delete the rule “${r.name}”?`)) remove.mutate(r) }}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}

      {dialog && selected !== null && (
        // key: a fresh form state for every open (new vs. each rule being edited)
        <RuleDialog key={dialog.rule?.id ?? 'new'} repoId={selected} rule={dialog.rule} open onOpenChange={(o) => !o && setDialog(null)} />
      )}
    </div>
  )
}
