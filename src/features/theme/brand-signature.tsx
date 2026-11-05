'use client';
import { useTheme } from './theme-provider';
export function BrandSignature({
  surface = 'sidebar',
  className,
}: {
  surface?: 'sidebar' | 'card';
  className?: string;
}) {
  const { theme, palette } = useTheme();
  const light =
    surface === 'card' ? theme === 'light' : palette === 'clean-slate' && theme === 'light';
  return (
    <img
      className={className}
      src={`/brand/d3im3r/horizontal-${light ? 'light' : 'dark'}.svg`}
      alt="d3im3r"
    />
  );
}
