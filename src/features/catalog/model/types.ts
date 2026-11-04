export type Block = { type: 'text' | 'code' | 'math' | 'diagram' | 'callout' | 'image' | 'list' | 'table'; content: string; language?: string; title?: string; variant?: string; children?: Block[]; items?: Block[][]; rows?: string[][]; asset?: string; start?: number };
export type Frame = { id: string; title: string; section: string; line: number; blocks: Block[] };
export type Lesson = { id: string; title: string; subtitle: string; institutionId: string; subjectId: string; topicId: string; source: string; pdf: string; frames: Frame[]; diagnostics: string[]; status?: 'draft'|'published' };
export type Institution = { id: string; name: string; shortName: string; city: string; color: string; logo?: string };
export type Subject = { id: string; institutionId: string; name: string; code: string; description: string; icon: 'code' | 'robot'; topics: {id: string; name: string}[] };
export type Catalog = { institutions: Institution[]; subjects: Subject[]; lessons: Lesson[] };
