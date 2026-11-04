import {betterAuth} from 'better-auth';
import {username,admin,bearer} from 'better-auth/plugins';
import {nextCookies} from 'better-auth/next-js';
import {db} from '@/features/administration/server/database';
import {passwordHash,passwordMatches} from './auth';
import {ac,roles} from './permissions';

function createAuth(){
 const googleClientId=process.env.GOOGLE_CLIENT_ID;
 const googleClientSecret=process.env.GOOGLE_CLIENT_SECRET;
 const hasGoogle=Boolean(googleClientId&&googleClientSecret);

 return betterAuth({
  database:db(),
  secret:process.env.BETTER_AUTH_SECRET??process.env.AULA_AUTH_SECRET??'aula-better-auth-default-secret-key-2026',
  baseURL:process.env.BETTER_AUTH_URL??process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3101',
  basePath:'/api/auth',
  trustedOrigins:['http://localhost:3101','http://127.0.0.1:3101'],
  emailAndPassword:{
   enabled:true,
   minPasswordLength:10,
   maxPasswordLength:256,
   password:{
    hash:async(password)=>passwordHash(password),
    verify:async({password,hash})=>passwordMatches(password,hash),
   },
  },
  socialProviders:hasGoogle?{
   google:{
    clientId:googleClientId!,
    clientSecret:googleClientSecret!,
   },
  }:undefined,
  session:{
   expiresIn:7*86400,
   updateAge:86400,
  },
  plugins:[
   username({
    minUsernameLength:3,
    maxUsernameLength:100,
    usernameValidator:(u)=>/^[a-z0-9][a-z0-9@._+-]{2,99}$/i.test(u),
   }),
   admin({
    ac,
    roles,
    defaultRole:'student',
    adminRoles:['teacher'],
   }),
   bearer(),
   nextCookies(),
  ],
 });
}

let instance:ReturnType<typeof createAuth>|undefined;

export function getAuth():ReturnType<typeof createAuth>{
 if(!instance)instance=createAuth();
 return instance;
}
