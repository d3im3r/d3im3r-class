'use client';

import { CheckCircle2, Info, Loader2, AlertOctagon, AlertTriangle } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps, toast } from 'sonner';
import { useTheme } from '@/features/theme/theme-provider';

export const Toaster = ({ position = 'bottom-right', ...props }: ToasterProps) => {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position={position}
      richColors
      closeButton
      icons={{
        success: <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />,
        info: <Info className="size-4 text-blue-500 shrink-0" />,
        warning: <AlertTriangle className="size-4 text-amber-500 shrink-0" />,
        error: <AlertOctagon className="size-4 text-rose-500 shrink-0" />,
        loading: <Loader2 className="size-4 animate-spin text-primary shrink-0" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-xl group-[.toaster]:rounded-xl group-[.toaster]:border font-sans',
          description: 'group-[.toast]:text-muted font-medium text-xs',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-semibold rounded-lg',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground font-semibold rounded-lg',
          closeButton:
            'group-[.toast]:bg-background group-[.toast]:text-foreground group-[.toast]:border-border',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--card, #ffffff)',
          '--normal-text': 'var(--foreground, #172338)',
          '--normal-border': 'var(--border, #dce3ed)',
          '--border-radius': '12px',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { toast };
