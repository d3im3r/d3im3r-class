import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants=cva('ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',{variants:{variant:{default:'bg-emerald-800 text-white hover:bg-emerald-900',outline:'border border-stone-200 bg-white hover:bg-stone-50 text-stone-700',ghost:'hover:bg-stone-100 text-stone-600'},size:{default:'h-10 px-4 py-2',sm:'h-8 px-3 text-xs',icon:'h-10 w-10'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,asChild=false,...props}:React.ComponentProps<'button'>&VariantProps<typeof buttonVariants>&{asChild?:boolean}){const Comp=asChild?Slot.Root:'button';return <Comp data-variant={variant??'default'} className={cn(buttonVariants({variant,size,className}))} {...props}/>;}
