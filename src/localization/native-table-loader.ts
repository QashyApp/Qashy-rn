/**
 * Fallback for tools that do not resolve platform extensions (TypeScript): the same shape as
 * both platform loaders. Metro picks `.native.ts` on Android and `.web.ts` in browsers first.
 */
export { loadNativeTable } from "./native-table-loader.web";
