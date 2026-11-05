import { createAuthClient } from 'better-auth/react';
import { usernameClient, adminClient } from 'better-auth/client/plugins';
import { ac, roles, hasPermission, type PermissionRequest } from './server/permissions';

export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    usernameClient(),
    adminClient({
      ac,
      roles,
    }),
  ],
});

export { hasPermission, type PermissionRequest };
