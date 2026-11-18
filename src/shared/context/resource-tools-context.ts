'use client';
import { createContext } from 'react';

/**
 * Context that indicates if the current user has permission
 * to test/inspect resources and code in the tools section.
 */
export const ResourceToolsContext = createContext<boolean>(false);
