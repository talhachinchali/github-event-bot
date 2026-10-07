import { Bot, GitPullRequest, MessageSquare, Sparkles, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ThemeToggle from './ThemeToggle'

const features = [
  { icon: Tag, title: 'Label automatically', text: 'Add labels to issues and PRs based on rules you define: title, description, author, labels or branch.' },
  { icon: MessageSquare, title: 'Alert Slack', text: 'Send a message to your channel the moment something needs attention.' },
  { icon: Sparkles, title: 'AI triage', text: 'Optionally summarise each issue, rate its priority and suggest a label with a free Gemini model.' },
  { icon: GitPullRequest, title: 'Reliable by design', text: 'Signed webhooks, no duplicates, automatic retries, and a full activity log of everything the bot did.' },
]

export default function Landing({ loginFailed }: { loginFailed: boolean }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 font-semibold"><Bot className="size-5" /> Repo Sentinel</div>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-16 pb-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">A bot that watches your GitHub repos</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
          Connect a repository, write a few simple rules, and let Repo Sentinel label, comment and notify your team, while you see everything it does.
        </p>
        {loginFailed && (
          <p role="alert" className="mx-auto mt-6 max-w-md rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Sign-in failed. Please try again.
          </p>
        )}
        <Button asChild size="lg" className="mt-8">
          <a href="/auth/github/login">Sign in with GitHub</a>
        </Button>
        <div className="mt-16 grid gap-4 text-left sm:grid-cols-2">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border bg-card p-5">
              <Icon className="mb-3 size-5 text-muted-foreground" />
              <div className="font-medium">{title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
