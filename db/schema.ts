import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  title: text("title").notNull(), author: text("author").notNull(),
  subtitle: text("subtitle").notNull().default(""), slug: text("slug").notNull(), blocks: text("blocks").notNull(),
  cover: text("cover").notNull().default(""), theme: text("theme").notNull().default("paper"),
  font: text("font").notNull().default("serif"), accent: text("accent").notNull().default("#a34e32"),
  alignment: text("alignment").notNull().default("left"), wide: integer("wide").notNull().default(0),
  shareTitle: text("share_title").notNull().default(""), shareDescription: text("share_description").notNull().default(""),
  shareImage: text("share_image").notNull().default(""), published: integer("published").notNull().default(0),
  views: integer("views").notNull().default(0), version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
  moderationBlocked: integer("moderation_blocked").notNull().default(0),
  moderationReason: text("moderation_reason").notNull().default(""),
}, (table) => [index("articles_owner_idx").on(table.ownerId)]);
export const paths = sqliteTable("paths", {
  slug: text("slug").primaryKey(),
  articleId: text("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("paths_article_idx").on(table.articleId)]);
export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  mime: text("mime").notNull(), bytes: integer("bytes").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("uploads_owner_idx").on(table.ownerId)]);
export const requestLimits = sqliteTable("request_limits", {
  key: text("key").primaryKey(), startsAt: integer("starts_at").notNull(), hits: integer("hits").notNull(),
});
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  articleId: text("article_id").references(() => articles.id, { onDelete: "set null" }),
  articleTitle: text("article_title").notNull(), articleSlug: text("article_slug").notNull(),
  reporterId: text("reporter_id").notNull(), reason: text("reason").notNull(), details: text("details").notNull().default(""),
  status: text("status").notNull().default("open"), createdAt: integer("created_at").notNull(), resolvedAt: integer("resolved_at"),
}, (table) => [index("reports_status_idx").on(table.status), index("reports_article_idx").on(table.articleId)]);
export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(), articleId: text("article_id").notNull(), ownerId: text("owner_id").notNull(),
  title: text("title").notNull(), objectKey: text("object_key").notNull(), action: text("action").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("backups_article_idx").on(table.articleId)]);
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(), actorId: text("actor_id").notNull(), articleId: text("article_id"),
  action: text("action").notNull(), details: text("details").notNull().default(""), createdAt: integer("created_at").notNull(),
});
export const objectChunks = sqliteTable("object_chunks", {
  objectKey: text("object_key").notNull(), part: integer("part").notNull(),
  data: text("data").notNull(), mime: text("mime").notNull(),
}, (table) => [index("object_chunks_key_idx").on(table.objectKey, table.part)]);
export const authors = sqliteTable("authors", { id:text("id").primaryKey(),telegramId:text("telegram_id").unique(),isAdmin:integer("is_admin").notNull().default(0),createdAt:integer("created_at").notNull() });
export const accessKeys = sqliteTable("access_keys", { keyHash:text("key_hash").primaryKey(),authorId:text("author_id").notNull().references(()=>authors.id,{onDelete:"cascade"}),createdAt:integer("created_at").notNull() });
export const accessLinks = sqliteTable("access_links", { keyHash:text("key_hash").primaryKey(),authorId:text("author_id").notNull().references(()=>authors.id,{onDelete:"cascade"}),kind:text("kind").notNull(),expiresAt:integer("expires_at").notNull() });
export const settings = sqliteTable("settings", {key:text("key").primaryKey(),value:text("value").notNull()});
