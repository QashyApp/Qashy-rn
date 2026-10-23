import {
  pickAsset,
  readAssetBytes,
  readAssetText,
} from "@/features/shared/pick-file";
import {
  MAX_SYNC_IMPORT_BYTES,
  MAX_VAULT_IMPORT_BYTES,
} from "@/utils/file-size";

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export async function pickBytes(): Promise<{
  name: string;
  bytes: Uint8Array;
} | null> {
  const asset = await pickAsset();
  if (!asset) return null;
  const bytes = await readAssetBytes(
    asset,
    MAX_VAULT_IMPORT_BYTES,
    "Vault backup",
  );
  return { name: asset.name, bytes };
}

export async function pickText(): Promise<string | null> {
  const asset = await pickAsset();
  if (!asset) return null;
  return readAssetText(asset, MAX_SYNC_IMPORT_BYTES, "Sync file");
}
