declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    LIST_ADMIN_EMAILS?: string;
  }
}
