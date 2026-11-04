import {createAccessControl} from 'better-auth/plugins/access';
import {defaultStatements,adminAc,userAc} from 'better-auth/plugins/admin/access';
import type {User,Role} from '../types';

export const aulaStatements={
 ...defaultStatements,
 campus:['manage','import','rebuild','review','publish','students','teachers','institutions','logo','ban'],
 tools:['use','inspectSource'],
 catalog:['readAll','readAssigned'],
 lesson:['readPublished','readDraft','downloadSource','downloadMaterial'],
 progress:['read','write'],
 user:['resetPasswordStudent','resetPasswordTeacher','createTeacher'],
} as const;

export const ac=createAccessControl(aulaStatements);

export const roles={
 admin:ac.newRole({
  ...adminAc.statements,
  campus:['manage','import','rebuild','review','publish','students','teachers','institutions','logo','ban'],
  tools:['use','inspectSource'],
  catalog:['readAll','readAssigned'],
  lesson:['readPublished','readDraft','downloadSource','downloadMaterial'],
  progress:['read','write'],
  user:['resetPasswordStudent','resetPasswordTeacher','createTeacher'],
 }),
 teacher:ac.newRole({
  ...adminAc.statements,
  campus:['manage','import','rebuild','review','publish','students','ban'],
  tools:['use','inspectSource'],
  catalog:['readAssigned'],
  lesson:['readPublished','readDraft','downloadSource','downloadMaterial'],
  progress:['read','write'],
  user:['resetPasswordStudent'],
 }),
 student:ac.newRole({
  ...userAc.statements,
  campus:[],
  tools:[],
  catalog:['readAssigned'],
  lesson:['readPublished'],
  progress:['read','write'],
  user:[],
 }),
} as const;

export type PermissionRequest={
 [K in keyof typeof aulaStatements]?: readonly (typeof aulaStatements)[K][number][];
};

export function hasPermission(user:Pick<User,'role'>|Role,permissions:PermissionRequest):boolean{
 const roleName=typeof user==='string'?user:user.role;
 const roleDef=roles[roleName as keyof typeof roles];
 if(!roleDef)return false;
 return roleDef.authorize(permissions as Record<string,string[]>).success;
}
