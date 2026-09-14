import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), name: text('name').notNull(), createdAt: integer('created_at').notNull(),
});
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), owner: text('owner').notNull().references(() => sessions.id),
  title: text('title').notNull(), currentVersion: integer('current_version').notNull().default(0),
  state: text('state').notNull().default('{}'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, t => [index('idx_projects_owner_updated').on(t.owner, t.updatedAt)]);
export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(), prompt: text('prompt').notNull(), summary: text('summary').notNull(),
  code: text('code').notNull(), mode: text('mode').notNull(), createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('idx_versions_project_number').on(t.projectId, t.number)]);
