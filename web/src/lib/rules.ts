import type { Condition, EventType, Rule, RuleAction } from '@/api'

export const EVENT_LABEL: Record<EventType, string> = { issues: 'Issue', pull_request: 'Pull request', push: 'Push' }
export const EVENT_VERB: Record<EventType, string> = { issues: 'an issue is opened', pull_request: 'a pull request is opened', push: 'code is pushed' }

export const FIELD_LABEL: Record<Condition['field'], string> = {
  title: 'Title', body: 'Description', author: 'Author', label: 'Label', branch: 'Branch',
}
export const OP_LABEL: Record<Condition['op'], string> = {
  contains: 'contains', not_contains: "doesn't contain", equals: 'is', starts_with: 'starts with',
}

/** Fields that exist for each event type (mirrors the server-side validation). */
export const FIELDS_FOR: Record<EventType, Condition['field'][]> = {
  issues: ['title', 'body', 'author', 'label'],
  pull_request: ['title', 'body', 'author', 'label', 'branch'],
  push: ['title', 'author', 'branch'],
}

export const ACTION_LABEL: Record<RuleAction['type'], string> = {
  add_label: 'Add label', comment: 'Post comment', slack: 'Send Slack alert', add_ai_label: 'Add AI-suggested label',
}

export function describeCondition(c: Condition): string {
  return `${FIELD_LABEL[c.field].toLowerCase()} ${OP_LABEL[c.op]} “${c.value}”`
}

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case 'add_label': return `add label “${a.label}”`
    case 'comment': return 'post a comment'
    case 'slack': return 'send a Slack alert'
    case 'add_ai_label': return 'add the AI-suggested label'
  }
}

/** "When an issue is opened and title contains “bug” → add label “bug”, send a Slack alert" */
export function describeRule(r: Pick<Rule, 'eventType' | 'conditions' | 'actions'>): string {
  const when = `When ${EVENT_VERB[r.eventType]}`
  const cond = r.conditions.length ? ` and ${r.conditions.map(describeCondition).join(' and ')}` : ''
  return `${when}${cond} → ${r.actions.map(describeAction).join(', ')}`
}
