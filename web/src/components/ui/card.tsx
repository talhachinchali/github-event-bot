import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-4 rounded-xl border bg-card py-5 text-card-foreground shadow-sm', className)} {...p} />
)
const CardHeader = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col gap-1.5 px-5', className)} {...p} />
)
const CardTitle = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('font-semibold leading-none', className)} {...p} />
)
const CardDescription = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('text-sm text-muted-foreground', className)} {...p} />
)
const CardContent = ({ className, ...p }: React.ComponentProps<'div'>) => <div className={cn('px-5', className)} {...p} />

export { Card, CardContent, CardDescription, CardHeader, CardTitle }
