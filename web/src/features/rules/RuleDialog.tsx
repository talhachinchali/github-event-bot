import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  ApiError, createRule, updateRule, type Condition, type EventType, type Rule, type RuleAction, type RuleInput,
} from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EVENT_LABEL, FIELDS_FOR, FIELD_LABEL, OP_LABEL } from '@/lib/rules'

interface FormState {
  name: string
  enabled: boolean
  eventType: EventType
  conditions: Condition[]
  addLabel: { on: boolean; label: string }
  comment: { on: boolean; body: string }
  slack: boolean
  aiLabel: boolean
  useAi: boolean
}

const blank: FormState = {
  name: '', enabled: true, eventType: 'issues', conditions: [],
  addLabel: { on: false, label: '' }, comment: { on: false, body: '' }, slack: true, aiLabel: false, useAi: false,
}

function fromRule(r: Rule): FormState {
  const find = <T extends RuleAction['type']>(t: T) => r.actions.find((a): a is Extract<RuleAction, { type: T }> => a.type === t)
  const label = find('add_label')
  const comment = find('comment')
  return {
    name: r.name, enabled: r.enabled, eventType: r.eventType, conditions: r.conditions,
    addLabel: { on: !!label, label: label?.label ?? '' }, comment: { on: !!comment, body: comment?.body ?? '' },
    slack: !!find('slack'), aiLabel: !!find('add_ai_label'), useAi: r.useAi,
  }
}

function toInput(f: FormState): RuleInput {
  const isPush = f.eventType === 'push'
  const actions: RuleAction[] = []
  if (!isPush && f.addLabel.on) actions.push({ type: 'add_label', label: f.addLabel.label.trim() })
  if (!isPush && f.comment.on) actions.push({ type: 'comment', body: f.comment.body.trim() })
  if (!isPush && f.useAi && f.aiLabel) actions.push({ type: 'add_ai_label' })
  if (f.slack) actions.push({ type: 'slack' })
  return {
    name: f.name.trim(), enabled: f.enabled, eventType: f.eventType, useAi: !isPush && f.useAi, actions,
    conditions: f.conditions.map((c) => ({ ...c, value: c.value.trim() })).filter((c) => c.value !== ''),
  }
}

const TEMPLATE_VARS = ['{{author}}', '{{number}}', '{{title}}', '{{repo}}', '{{url}}', '{{ai_summary}}', '{{ai_priority}}']

export default function RuleDialog({
  repoId, rule, open, onOpenChange,
}: { repoId: number; rule: Rule | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<FormState>(() => (rule ? fromRule(rule) : blank))
  const [problems, setProblems] = useState<string[]>([])
  const isPush = f.eventType === 'push'
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))

  const save = useMutation({
    mutationFn: (input: RuleInput) => (rule ? updateRule(repoId, rule.id, input) : createRule(repoId, input)),
    onSuccess: () => {
      toast.success(rule ? 'Rule updated' : 'Rule created')
      void qc.invalidateQueries({ queryKey: ['rules', repoId] })
      onOpenChange(false)
    },
    onError: (e: Error) => {
      setProblems(e instanceof ApiError && e.issues.length ? e.issues.map((i) => i.message) : [e.message])
    },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const input = toInput(f)
    const local: string[] = []
    if (!input.name) local.push('Give the rule a name.')
    if (f.addLabel.on && !f.addLabel.label.trim()) local.push('Enter the label to add.')
    if (f.comment.on && !f.comment.body.trim()) local.push('Write the comment to post.')
    if (input.actions.length === 0) local.push('Choose at least one action.')
    setProblems(local)
    if (local.length === 0) save.mutate(input)
  }

  function changeEventType(eventType: EventType) {
    // Drop conditions that don't exist for the new event type (e.g. "branch" on issues).
    set({ eventType, conditions: f.conditions.filter((c) => FIELDS_FOR[eventType].includes(c.field)) })
  }

  const updateCondition = (i: number, patch: Partial<Condition>) =>
    set({ conditions: f.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>When something happens in the repository and the conditions match, the bot runs the actions.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Label bug reports" />
          </div>

          <div className="grid gap-2">
            <Label>When…</Label>
            <Select value={f.eventType} onValueChange={(v) => changeEventType(v as EventType)}>
              <SelectTrigger className="w-full sm:w-72" aria-label="Event type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(EVENT_LABEL) as EventType[]).map((t) => (
                  <SelectItem key={t} value={t}>{t === 'issues' ? 'an issue is opened' : t === 'pull_request' ? 'a pull request is opened' : 'code is pushed'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>…and all of these match <span className="font-normal text-muted-foreground">(optional)</span></Label>
            {f.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={c.field} onValueChange={(v) => updateCondition(i, { field: v as Condition['field'] })}>
                  <SelectTrigger className="w-32" aria-label="Field"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELDS_FOR[f.eventType].map((x) => <SelectItem key={x} value={x}>{FIELD_LABEL[x]}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={c.op} onValueChange={(v) => updateCondition(i, { op: v as Condition['op'] })}>
                  <SelectTrigger className="w-40" aria-label="Operator"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(OP_LABEL) as Condition['op'][]).map((x) => <SelectItem key={x} value={x}>{OP_LABEL[x]}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="min-w-40 flex-1" aria-label="Value" maxLength={200} value={c.value} placeholder="text to match (not case sensitive)" onChange={(e) => updateCondition(i, { value: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" onClick={() => set({ conditions: f.conditions.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
            ))}
            {f.conditions.length < 10 && (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => set({ conditions: [...f.conditions, { field: FIELDS_FOR[f.eventType][0]!, op: 'contains', value: '' }] })}>
                <Plus /> Add condition
              </Button>
            )}
            {f.conditions.length === 0 && <p className="text-xs text-muted-foreground">No conditions: the rule runs for every {EVENT_LABEL[f.eventType].toLowerCase()}.</p>}
          </div>

          <div className="grid gap-3">
            <Label>Then…</Label>
            {isPush ? (
              <p className="text-xs text-muted-foreground">Pushes have no issue or PR to label or comment on, so push rules can only send Slack alerts.</p>
            ) : (
              <>
                <div className="grid gap-2 rounded-lg border p-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={f.addLabel.on} onCheckedChange={(on) => set({ addLabel: { ...f.addLabel, on } })} /> Add a label</label>
                  {f.addLabel.on && <Input aria-label="Label name" maxLength={50} value={f.addLabel.label} onChange={(e) => set({ addLabel: { ...f.addLabel, label: e.target.value } })} placeholder="bug" />}
                </div>
                <div className="grid gap-2 rounded-lg border p-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={f.comment.on} onCheckedChange={(on) => set({ comment: { ...f.comment, on } })} /> Post a comment</label>
                  {f.comment.on && (
                    <>
                      <Textarea aria-label="Comment text" maxLength={2000} value={f.comment.body} onChange={(e) => set({ comment: { ...f.comment, body: e.target.value } })} placeholder="Thanks @{{author}}! We'll take a look." />
                      <p className="text-xs text-muted-foreground">Placeholders: {TEMPLATE_VARS.join('  ')}</p>
                    </>
                  )}
                </div>
              </>
            )}
            <div className="rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm"><Switch checked={f.slack} onCheckedChange={(slack) => set({ slack })} /> Send a Slack alert</label>
            </div>
          </div>

          {!isPush && (
            <div className="grid gap-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={f.useAi} onCheckedChange={(useAi) => set({ useAi, aiLabel: useAi ? f.aiLabel : false })} /> AI triage</label>
              <p className="text-xs text-muted-foreground">
                Summarises the item, rates its priority and makes the summary available to Slack alerts and comments ({'{{ai_summary}}'}, {'{{ai_priority}}'}).
              </p>
              {f.useAi && (
                <>
                  <label className="flex items-center gap-2 text-sm"><Switch checked={f.aiLabel} onCheckedChange={(aiLabel) => set({ aiLabel })} /> Also add the label the AI suggests</label>
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    Sends the issue or PR text to Google Gemini. On the free tier Google may use it to improve its products, so only enable this for public repositories.
                  </p>
                </>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm"><Switch checked={f.enabled} onCheckedChange={(enabled) => set({ enabled })} /> Rule is enabled</label>

          {problems.length > 0 && (
            <ul role="alert" className="list-disc rounded-md border border-destructive/40 bg-destructive/10 py-2 pr-3 pl-7 text-sm text-destructive">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="animate-spin" />} {rule ? 'Save changes' : 'Create rule'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
