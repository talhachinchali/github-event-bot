import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchSlackStatus, removeSlackWebhook, saveSlackWebhook, testSlack } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Settings() {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const status = useQuery({ queryKey: ['slack'], queryFn: fetchSlackStatus })
  const refresh = () => qc.invalidateQueries({ queryKey: ['slack'] })
  const failed = (e: Error) => toast.error(e.message)

  const save = useMutation({
    mutationFn: () => saveSlackWebhook(url.trim()),
    onSuccess: () => { setUrl(''); toast.success('Saved. Send a test message to verify.'); void refresh() },
    onError: failed,
  })
  const test = useMutation({ mutationFn: testSlack, onSuccess: () => toast.success('Test message sent. Check your Slack channel.'), onError: failed })
  const remove = useMutation({ mutationFn: removeSlackWebhook, onSuccess: () => { toast.success('Slack webhook removed'); void refresh() }, onError: failed })
  const configured = status.data?.configured

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Slack notifications</CardTitle>
          {status.data && (configured
            ? <Badge variant="success"><CheckCircle2 /> Connected</Badge>
            : <Badge variant="secondary">Not connected</Badge>)}
        </div>
        <CardDescription>
          Create an <em>Incoming Webhook</em> for your Slack app and paste its URL here. It is stored encrypted and is never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(e) => { e.preventDefault(); if (url.trim()) save.mutate() }}
        >
          <Label htmlFor="slack-url">Webhook URL</Label>
          <div className="flex gap-2">
            <Input
              id="slack-url" type="password" autoComplete="off" spellCheck={false} value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={configured ? 'Paste a new URL to replace the saved one' : 'https://hooks.slack.com/services/…'}
            />
            <Button type="submit" disabled={save.isPending || url.trim() === ''}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
        {configured && (
          <div className="flex gap-2">
            <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send test message
            </Button>
            <Button variant="outline" className="text-destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 /> Remove
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
