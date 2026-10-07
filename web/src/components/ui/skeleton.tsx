import * as React from 'react'
import { cn } from '@/lib/utils'

export const Skeleton = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('animate-pulse rounded-md bg-accent', className)} {...p} />
)
