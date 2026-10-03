import { mapCashewBackup } from "@/data/import/cashew/mapper";
import { readCashewBackup } from "@/data/import/cashew/reader";
import type {
  ImportBundle,
  ImportSourceId,
  ParseOptions,
} from "@/data/import/types";

/** Reads a backup file from another app and maps it to an `ImportBundle`. Pure; throws `ImportError`. */
export function parseExternalBackup(
  source: ImportSourceId,
  bytes: Uint8Array,
  options: ParseOptions,
): ImportBundle {
  switch (source) {
    case "cashew":
      return mapCashewBackup(readCashewBackup(bytes), options);
    default: {
      const unreachable: never = source;
      throw new Error(`Unsupported import source: ${String(unreachable)}`);
    }
  }
}
