import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'

const Tabs = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Root>) => (
  <TabsPrimitive.Root className={cn('flex flex-col gap-4', className)} {...p} />
)
const TabsList = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground', className)} {...p} />
)
const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-3 text-sm font-medium outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-input/40 [&_svg]:size-4",
      className,
    )}
    {...p}
  />
)
const TabsContent = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('outline-none', className)} {...p} />
)

export { Tabs, TabsContent, TabsList, TabsTrigger }
