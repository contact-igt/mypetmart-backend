import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, non-nullable with a safe default: distinguishes an image
// MediaAsset from a video one so the Media Gallery/Picker can filter and
// branch rendering without re-parsing mime_type everywhere. Every historical
// MediaAsset backfills to 'image' (the only type that has ever existed until
// this migration) — MySQL fills the DEFAULT for existing rows on this ALTER,
// no separate UPDATE needed. media_type is always derived server-side from
// the verified upload's MIME type (see MediaAssetService.completeUpload),
// never trusted from client input.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'media_assets' AND column_name = 'media_type'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`media_assets\`
      ADD COLUMN \`media_type\` ENUM('image', 'video') NOT NULL DEFAULT 'image' AFTER \`mime_type\`,
      ADD KEY \`media_assets_media_type_idx\` (\`media_type\`);
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`media_assets\`
      DROP KEY \`media_assets_media_type_idx\`,
      DROP COLUMN \`media_type\`;
  `);
}
