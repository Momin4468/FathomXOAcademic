import { createReadStream } from "node:fs";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Blob storage behind a tiny interface (DESIGN_SPEC §11: the DB stores metadata,
 * never blobs). The backend is chosen by `STORAGE_ADAPTER` (default `local`): the
 * unchanged local-disk impl for dev, or Supabase Storage for prod (Render's disk is
 * ephemeral). Keys are server-generated UUIDs (path-traversal guard), so both
 * adapters share the same opaque-key contract. `readStream` returns a Node
 * `Readable` (the local `ReadStream` is one; Supabase wraps a downloaded buffer).
 */
interface StorageAdapter {
  put(buffer: Buffer): Promise<string>;
  readStream(key: string): Promise<Readable>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}$/i;

/** Local-disk backend (unchanged behavior; `STORAGE_DIR` default `<cwd>/storage/uploads`). */
class LocalStorageAdapter implements StorageAdapter {
  private readonly logger = new Logger("LocalStorage");
  private readonly dir: string;
  private ready: Promise<void>;

  constructor() {
    const configured = process.env.STORAGE_DIR ?? "storage/uploads";
    this.dir = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
    this.ready = mkdir(this.dir, { recursive: true }).then(() => undefined);
  }

  async put(buffer: Buffer): Promise<string> {
    await this.ready;
    const key = randomUUID();
    await writeFile(this.absolute(key), buffer);
    return key;
  }

  async readStream(key: string): Promise<Readable> {
    return createReadStream(this.absolute(key));
  }

  async size(key: string): Promise<number> {
    const s = await stat(this.absolute(key));
    return s.size;
  }

  async remove(key: string): Promise<void> {
    await rm(this.absolute(key), { force: true }).catch((e) => this.logger.warn(`remove ${key}: ${e}`));
  }

  /** Resolve a key to an absolute path, rejecting anything that isn't a bare UUID. */
  private absolute(key: string): string {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    return resolve(this.dir, key);
  }
}

/** Supabase Storage backend (prod). Bucket must be PRIVATE; uses the service-role key. */
class SupabaseStorageAdapter implements StorageAdapter {
  private readonly logger = new Logger("SupabaseStorage");
  private readonly sb: SupabaseClient;
  private readonly bucket: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "";
    if (!url || !key) {
      throw new Error("STORAGE_ADAPTER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    if (!this.bucket) {
      throw new Error("STORAGE_ADAPTER=supabase requires SUPABASE_STORAGE_BUCKET");
    }
    // Server-to-server; no session persistence/refresh needed.
    this.sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private assertKey(key: string): void {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
  }

  async put(buffer: Buffer): Promise<string> {
    const key = randomUUID();
    const { error } = await this.sb.storage.from(this.bucket).upload(key, buffer, {
      contentType: "application/octet-stream",
    });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return key;
  }

  async readStream(key: string): Promise<Readable> {
    this.assertKey(key);
    const { data, error } = await this.sb.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Supabase download failed: ${error?.message ?? "no data"}`);
    return Readable.from(Buffer.from(await data.arrayBuffer()));
  }

  async size(key: string): Promise<number> {
    this.assertKey(key);
    // Prefer object metadata over re-downloading (the byte size is also persisted on
    // file_object). `size` is currently unused by callers; keep it cheap + best-effort.
    const { data } = await this.sb.storage.from(this.bucket).info(key);
    return data?.size ?? 0;
  }

  async remove(key: string): Promise<void> {
    this.assertKey(key);
    const { error } = await this.sb.storage.from(this.bucket).remove([key]);
    if (error) this.logger.warn(`remove ${key}: ${error.message}`);
  }
}

@Injectable()
export class StorageService {
  private readonly adapter: StorageAdapter;

  constructor() {
    const which = (process.env.STORAGE_ADAPTER ?? "local").toLowerCase();
    this.adapter = which === "supabase" ? new SupabaseStorageAdapter() : new LocalStorageAdapter();
  }

  /** Persist a blob; returns the opaque storage key (a UUID). */
  put(buffer: Buffer): Promise<string> {
    return this.adapter.put(buffer);
  }

  /** Open a read stream for a stored key (key must be a UUID — guarded). */
  readStream(key: string): Promise<Readable> {
    return this.adapter.readStream(key);
  }

  size(key: string): Promise<number> {
    return this.adapter.size(key);
  }

  remove(key: string): Promise<void> {
    return this.adapter.remove(key);
  }
}
