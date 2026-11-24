import { rebuildLesson } from '../src/features/administration/server/rebuild-lesson';

const id = process.argv[2];
if (!id) throw new Error('Indica el identificador de la clase.');

const result = await rebuildLesson(id);
console.log(JSON.stringify({ lessonId: id, ...result }));
