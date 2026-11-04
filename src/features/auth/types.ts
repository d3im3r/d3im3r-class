export type Role='teacher'|'student';
export type User={id:string;name:string;username:string;role:Role};
export type Progress=Record<string,string[]>;
