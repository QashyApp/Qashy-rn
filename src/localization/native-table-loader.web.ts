/**
 * Web: Play-translated languages are Android only, so there is nothing to load. This stub
 * keeps the runtime list (`android-runtime.json`) and the native module out of the web bundle,
 * and never calls native. It is never reached, because no Play language is offered on web.
 */

import {
  EMPTY_NATIVE_TABLE,
  type NativeTable,
} from "@/localization/native-table";

export async function loadNativeTable(
  _localeTag: string,
): Promise<NativeTable> {
  return EMPTY_NATIVE_TABLE;
}
