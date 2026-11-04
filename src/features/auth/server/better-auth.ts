import {betterAuth} from 'better-auth';
import {username,admin,bearer} from 'better-auth/plugins';
import {nextCookies} from 'better-auth/next-js';
import {db,getPgPool} from '@/features/administration/server/database';
import {passwordHash,passwordMatches} from './auth';
import {ac,roles} from './permissions';

function getDatabase(){
 const pool=getPgPool();
 if(pool)return pool;
 return db();
}

function getTrustedOrigins(){
 const origins=['http://localhost:3101','http://127.0.0.1:3101','http://localhost:3000','http://127.0.0.1:3000','https://d3im3r-class.vercel.app'];
 if(process.env.BETTER_AUTH_URL)origins.push(process.env.BETTER_AUTH_URL);
 if(process.env.NEXT_PUBLIC_APP_URL)origins.push(process.env.NEXT_PUBLIC_APP_URL);
 if(process.env.VERCEL_URL)origins.push(`https://${process.env.VERCEL_URL}`);
 if(process.env.VERCEL_PROJECT_PRODUCTION_URL)origins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
 return Array.from(new Set(origins.filter(Boolean)));
}

function createAuth(){
 const googleClientId=process.env.GOOGLE_CLIENT_ID;
 const googleClientSecret=process.env.GOOGLE_CLIENT_SECRET;
 const hasGoogle=Boolean(googleClientId&&googleClientSecret);

 return betterAuth({
  database:getDatabase(),
  secret:process.env.BETTER_AUTH_SECRET??process.env.AULA_AUTH_SECRET??'aula-better-auth-default-secret-key-2026',
  baseURL:process.env.BETTER_AUTH_URL??process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3101',
  basePath:'/api/auth',
  trustedOrigins:getTrustedOrigins(),
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
    adminRoles:['admin','teacher'],
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
