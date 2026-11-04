import {mkdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {db,dataDirectory} from '../src/features/administration/server/database';
import {rebuildLesson} from '../src/features/administration/server/rebuild-lesson';
const id=process.argv[2];if(!id)throw Error('Indica el identificador de la clase.');
const folder=path.join(dataDirectory(),'backups');mkdirSync(folder,{recursive:true});const backup=path.join(folder,`before-resource-repair-${Date.now()}.sqlite`);db().prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);
const result=await rebuildLesson(id);console.log(JSON.stringify({lessonId:id,backup,...result}));
