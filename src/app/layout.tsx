import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import {ThemeProvider} from '@/features/theme/theme-provider';
import {themeScript} from '@/features/theme/theme-script';
export const metadata:Metadata={title:'Aula · Un espacio para aprender',description:'Tus asignaturas, clases y laboratorios, en un solo lugar.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body><ThemeProvider>{children}</ThemeProvider></body></html>;}
