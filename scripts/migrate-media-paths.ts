import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, client } from "../server/db";
import { getMediaDir } from "../server/config/env";
import { audioFiles, passages } from "../server/db/schema";

// One-time, idempotent migration: rewrite legacy ABSOLUTE media paths in the DB to the portable
// form — a path RELATIVE to MEDIA_DIR under a section subfolder (listening/ or reading/) — and copy
// the file into the media store so MEDIA_DIR becomes self-contained. Rows already relative are left
// untouched, so re-running is a no-op. Pairs with the relative-path serve resolution in
// server/services/questions.ts. Run with `npm run db:migrate-media`.

type Row = { id: number; path: string };

// Move one row's file into MEDIA_DIR/<section>/ (if the source still exists) and return the new
// relative path. Already-relative paths are returned unchanged (no copy).
function relocate(section: "listening" | "reading", current: string): string {
  if (!isAbsolute(current)) return current;
  const mediaDir = getMediaDir();
  const rel = join(section, basename(current));
  const dest = resolve(mediaDir, rel);
  mkdirSync(resolve(mediaDir, section), { recursive: true });
  if (existsSync(current) && !existsSync(dest)) {
    copyFileSync(current, dest);
  } else if (!existsSync(current) && !existsSync(dest)) {
    console.warn(
      `• Source missing on disk: ${current} — rewrote the reference, but the file must be placed at ${dest}.`,
    );
  }
  return rel;
}

async function main(): Promise<void> {
  let audioMigrated = 0;
  let passageMigrated = 0;

  const audioRows: Row[] = await db
    .select({ id: audioFiles.id, path: audioFiles.filePath })
    .from(audioFiles);
  for (const row of audioRows) {
    const rel = relocate("listening", row.path);
    if (rel !== row.path) {
      await db
        .update(audioFiles)
        .set({ filePath: rel })
        .where(eq(audioFiles.id, row.id));
      audioMigrated += 1;
    }
  }

  const passageRows: Row[] = await db
    .select({ id: passages.id, path: passages.sourceFile })
    .from(passages);
  for (const row of passageRows) {
    const rel = relocate("reading", row.path);
    if (rel !== row.path) {
      await db
        .update(passages)
        .set({ sourceFile: rel })
        .where(eq(passages.id, row.id));
      passageMigrated += 1;
    }
  }

  console.log(
    `Media-path migration complete: ${audioMigrated} audio_files and ${passageMigrated} passages ` +
      `rewritten to MEDIA_DIR-relative paths (${getMediaDir()}).`,
  );
  client.close();
}

main().catch((error: unknown) => {
  console.error("Media-path migration failed:", error);
  process.exit(1);
});
