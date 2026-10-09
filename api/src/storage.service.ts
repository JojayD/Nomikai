import { Injectable, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'photos';
const SIGNED_URL_TTL = 3600;

// The secret key bypasses storage RLS, so every caller here must already have
// decided the viewer may see the path. Paths are always `{userId}/...`.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );

  /** Batch-signs paths (nulls and duplicates dropped) → path → URL. */
  async sign(
    paths: (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(paths.filter((p): p is string => !!p))];
    const map = new Map<string, string>();
    if (!unique.length) return map;
    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrls(unique, SIGNED_URL_TTL);
    if (error) this.logger.warn('Could not sign photo URLs');
    for (const d of data ?? []) {
      if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
    }
    return map;
  }

  async upload(path: string, body: Buffer, contentType: string) {
    const { error } = await this.supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) throw error;
  }

  async remove(paths: string[]) {
    if (!paths.length) return;
    const { error } = await this.supabase.storage.from(BUCKET).remove(paths);
    if (error) throw error;
  }

  /** Re-read the first page after deletion so removing rows cannot skip objects. */
  async removeFolder(userId: string) {
    while (true) {
      const { data, error } = await this.supabase.storage
        .from(BUCKET)
        .list(userId, { limit: 100 });
      if (error) throw error;
      if (!data?.length) return;
      for (const folder of data.filter((f) => !f.id)) {
        await this.removeFolder(`${userId}/${folder.name}`);
      }
      await this.remove(
        data.filter((f) => f.id).map((f) => `${userId}/${f.name}`),
      );
    }
  }

  async deleteAuthUser(userId: string) {
    const { error } = await this.supabase.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
}
