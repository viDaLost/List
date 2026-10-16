import {table,text,integer} from 'sdk/db';
export const settings=table('settings',{key:text('key').primaryKey(),value:text('value').notNull()});
export const users=table('users',{telegramId:integer('telegram_id').primaryKey(),authorId:text('author_id').notNull(),updatedAt:integer('updated_at').notNull()});
