/**
 * The merge core: folding ops into causal state, and projecting that state back into
 * entities the rest of the app can read.
 *
 * Every path into the merge goes through the functions here — a delta of ops from a peer,
 * a full-state catch-up for a peer that fell behind the compaction watermark, and a local
 * write echoed back through the decorator all end up in `applyOp` or `mergeMeta`, which
 * share their per-slot comparison logic. That is deliberate: two merge implementations
 * that agree today drift apart the first time one of them is fixed, and a merge that
 * disagrees with itself does not converge — it forks, permanently, with no error.
 *
 * The three properties this file must have, and which the property tests assert directly:
 *
 * - **Commutative** — order of arrival cannot matter, because it is not controllable.
 * - **Idempotent** — a relay that re-delivers a batch, or a peer that sends an overlapping
 *   range, must change nothing.
 * - **Associative** — a device that merged A then B, and one that merged B then A, and one
 *   that received them as a single batch, must all land on the same state.
 *
 * Nothing here reads a clock, generates an id, or touches storage.
 */

import { eraseEntity, eraseField, isErasable } from "@/domain/erasure";
import type { EntityType, FinanceEntity } from "@/domain/models";
import { OP_SCHEMA_VERSION } from "@/sync/crypto";
import { canonicalJson } from "@/utils/canonical-json";
import { hlcToIso, maxHlc, type Hlc } from "@/sync/oplog/hlc";
import {
  createOnlyFieldsOf,
  deviceLocalFieldsOf,
  elementSetsOf,
  isEntityType,
  keyedMapsOf,
  readPath,
  readRegisteredPath,
  registersOf,
  writePath,
  type RegisterSpec,
} from "@/sync/oplog/registry";
import {
  OP_KINDS,
  emptyMeta,
  metaKey,
  type CausalMeta,
  type DeletionState,
  type ElementState,
  type MapEntryState,
  type RegisterState,
  type SyncOpBody,
} from "@/sync/oplog/types";

/**
 * Every register value is an object keyed by field path, even a register with one field.
 *
 * The uniformity is worth the handful of extra bytes: a group and a lone LWW field then
 * merge through identical code, so there is no second path for someone to forget when the
 * registry grows a group later.
 */
export type RegisterValue = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Per-slot comparisons — the whole of the conflict-resolution policy
// ---------------------------------------------------------------------------

const pickRegister = (
  spec: RegisterSpec,
  existing: RegisterState | undefined,
  incoming: RegisterState,
): RegisterState => {
  if (!existing) return incoming;
  switch (spec.strategy.kind) {
    case "monotoneMax": {
      // The larger value wins outright, whatever the clocks say. `nextDueDate` under plain
      // LWW would rewind whenever a device that had not yet advanced it reconnected, and
      // `generateRecurring` would re-walk the same span on every launch, forever.
      const field = spec.fields[0];
      const existingValue = existing.value as RegisterValue;
      const incomingValue = incoming.value as RegisterValue;
      const left = existingValue[field];
      const right = incomingValue[field];
      if (left === right)
        return existing.hlc >= incoming.hlc ? existing : incoming;
      return compareScalar(left, right) >= 0 ? existing : incoming;
    }
    case "monotoneTrue": {
      const field = spec.fields[0];
      const value =
        (existing.value as RegisterValue)[field] === true ||
        (incoming.value as RegisterValue)[field] === true;
      return {
        hlc: maxHlc(existing.hlc, incoming.hlc),
        value: { [field]: value },
      };
    }
    default:
      return incoming.hlc > existing.hlc ? incoming : existing;
  }
};

/** Total order over the scalar kinds a monotone register can hold. */
const compareScalar = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};

const pickElement = (
  existing: ElementState | undefined,
  incoming: ElementState,
): ElementState => {
  if (!existing) return incoming;
  return {
    addHlc: laterOrNull(existing.addHlc, incoming.addHlc),
    removeHlc: laterOrNull(existing.removeHlc, incoming.removeHlc),
  };
};

const laterOrNull = (first: Hlc | null, second: Hlc | null): Hlc | null => {
  if (first === null) return second;
  if (second === null) return first;
  return maxHlc(first, second);
};

/** Add-wins: an element added and removed at the same reading stays. */
export const isElementPresent = (state: ElementState) =>
  state.addHlc !== null &&
  (state.removeHlc === null || state.addHlc >= state.removeHlc);

const pickMapEntry = (
  existing: MapEntryState | undefined,
  incoming: MapEntryState,
): MapEntryState =>
  !existing || incoming.hlc > existing.hlc ? incoming : existing;

/**
 * Deletion, biased to delete only on an exact tie.
 *
 * Not an absorbing state. §2.6's repair resurrects a tombstoned account that a merged-in
 * transaction still references, and it can only do that if a later `restore` — or a later
 * write of any kind — can move the register back.
 */
const pickDeletion = (
  existing: DeletionState | null,
  incoming: DeletionState,
): DeletionState => {
  if (!existing) return incoming;
  if (incoming.hlc > existing.hlc) return incoming;
  if (incoming.hlc < existing.hlc) return existing;
  return existing.at !== null ? existing : incoming;
};

// ---------------------------------------------------------------------------
// Reading an entity into register / set / map shape
// ---------------------------------------------------------------------------

export const registerValueOf = (
  spec: RegisterSpec,
  source: unknown,
): RegisterValue =>
  Object.fromEntries(
    spec.fields.map((field) => [field, readPath(source, field) ?? null]),
  );

const elementsOf = (source: unknown, path: string): string[] => {
  const value = readPath(source, path);
  return Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : [];
};

const mapEntriesOf = (
  source: unknown,
  path: string,
  key: string,
): Record<string, unknown> => {
  const value = readPath(source, path);
  if (!Array.isArray(value)) return {};
  const entries: Record<string, unknown> = {};
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = (entry as Record<string, unknown>)[key];
    if (typeof id === "string") entries[id] = entry;
  }
  return entries;
};

// ---------------------------------------------------------------------------
// Applying one op
// ---------------------------------------------------------------------------

const withRegister = (
  meta: CausalMeta,
  spec: RegisterSpec,
  incoming: RegisterState,
): CausalMeta => {
  const picked = pickRegister(spec, meta.registers[spec.name], incoming);
  if (picked === meta.registers[spec.name]) return meta;
  return { ...meta, registers: { ...meta.registers, [spec.name]: picked } };
};

const withElements = (
  meta: CausalMeta,
  path: string,
  updates: Readonly<Record<string, ElementState>>,
): CausalMeta => {
  const existing = meta.sets[path] ?? {};
  const next = { ...existing };
  for (const [element, state] of Object.entries(updates)) {
    next[element] = pickElement(existing[element], state);
  }
  return { ...meta, sets: { ...meta.sets, [path]: next } };
};

const withMapEntries = (
  meta: CausalMeta,
  path: string,
  updates: Readonly<Record<string, MapEntryState>>,
): CausalMeta => {
  const existing = meta.maps[path] ?? {};
  const next = { ...existing };
  for (const [key, state] of Object.entries(updates)) {
    next[key] = pickMapEntry(existing[key], state);
  }
  return { ...meta, maps: { ...meta.maps, [path]: next } };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : [];

/**
 * True when this build can interpret the op at all.
 *
 * An op that fails this is **not** an error and **not** dropped: it is kept in
 * `CausalMeta.unknown`, still stored in `sync_ops`, and still forwarded to every other
 * peer. Dropping it would break the hash chain for everyone downstream — and the edit it
 * carries reappears intact the moment this device is updated.
 */
const isInterpretable = (op: SyncOpBody) =>
  op.schema <= OP_SCHEMA_VERSION &&
  isEntityType(op.entityType) &&
  OP_KINDS.includes(op.kind);

/**
 * A grouped register is atomic on the wire as well as during local diffing. Without this
 * check, a signed partial group can win LWW and erase the omitted fields from the projection.
 * Unknown registers remain forward-compatible; only a register this build understands is
 * constrained by its declared field group.
 */
export const hasCompleteKnownRegisters = (op: SyncOpBody): boolean => {
  if (!isInterpretable(op)) return true;
  if (op.kind === "create") {
    const entity = asRecord(op.payload.entity);
    // Older wire fixtures and forward-compatible entities may omit the immutable id; when it
    // is present, however, it must agree with the authenticated entity key.
    return entity.id === undefined || entity.id === op.entityId;
  }
  if (op.kind !== "set") return true;
  const registers = asRecord(op.payload.registers);
  for (const spec of registersOf(op.entityType)) {
    if (!(spec.name in registers)) continue;
    const value = registers[spec.name];
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    if (spec.fields.some((field) => !(field in value))) return false;
  }
  return true;
};

/** Identity of an uninterpretable op within one entity, including its payload. */
const unknownKey = (op: SyncOpBody) =>
  canonicalJson({
    entityId: op.entityId,
    entityType: op.entityType,
    hlc: op.hlc,
    kind: op.kind,
    payload: op.payload,
    schema: op.schema,
  });

const sortUnknown = (ops: readonly SyncOpBody[]): SyncOpBody[] =>
  [...ops].sort((first, second) => {
    const left = unknownKey(first);
    const right = unknownKey(second);
    return left < right ? -1 : left > right ? 1 : 0;
  });

// ---------------------------------------------------------------------------
// Erasure — a deleted entity's merge state holds no content
// ---------------------------------------------------------------------------

/** The newest delete reading this state has seen; see `CausalMeta.erasedThrough`. */
const erasureThreshold = (meta: CausalMeta): Hlc | null =>
  meta.erasedThrough ?? (meta.deleted?.at ? meta.deleted.hlc : null);

const withErasureAt = (meta: CausalMeta, hlc: Hlc): CausalMeta => ({
  ...meta,
  erasedThrough: laterOrNull(erasureThreshold(meta), hlc),
});

/**
 * Replaces everything a delete covered with its erased value.
 *
 * `records` erases tombstones on write, but the causal state keeps the register values a
 * projection is built from, so it has to be erased as well or deleting would only hide.
 *
 * What makes it safe to run inside a CRDT is that it is a pure function of slots and clock
 * readings: a slot written at or before the newest delete reading is erased, and a slot written
 * after it is not. Each slot keeps its own reading, so last-writer-wins still picks the same
 * winner in either arrival order and the merge stays commutative, idempotent and associative —
 * an edit made after the delete, by a device that had not heard of it yet, still lands.
 *
 * Two register strategies compare values rather than readings, so erasing them would make the
 * result depend on arrival order. Neither holds anything the user entered: `monotoneTrue` is
 * the settings onboarding flag, and settings are never deleted; `monotoneMax` is a schedule's
 * `nextDueDate`, which the projection still erases on its way into `records`.
 */
export function eraseDeletedState(meta: CausalMeta): CausalMeta {
  const through = erasureThreshold(meta);
  if (through === null || !isErasable(meta.entityType)) return meta;
  const erase = (field: string, value: unknown) =>
    eraseField(meta.entityType, field, value);

  const specs = new Map(
    registersOf(meta.entityType).map((spec) => [spec.name, spec]),
  );
  const registers: Record<string, RegisterState> = {};
  for (const [name, state] of Object.entries(meta.registers)) {
    const spec = specs.get(name);
    if (
      state.hlc > through ||
      spec?.strategy.kind === "monotoneMax" ||
      spec?.strategy.kind === "monotoneTrue"
    ) {
      registers[name] = state;
      continue;
    }
    // A register this build does not know is erased whole: there is no way to tell which of
    // its values would be safe to keep.
    const value = asRecord(state.value);
    registers[name] = {
      hlc: state.hlc,
      value: spec
        ? Object.fromEntries(
            spec.fields.map((field) => [
              field,
              erase(field, value[field] ?? null),
            ]),
          )
        : null,
    };
  }

  // Every element counts as removed at the delete. An add at or before it is forgotten, and an
  // element left with no later add and no later remove is dropped entirely — `{ add: null,
  // remove: through }` is what it would hold, and re-deriving that from `through` alone gives
  // the same answer in every arrival order — so nothing records which ids were ever in the set.
  const sets: Record<string, Record<string, ElementState>> = {};
  for (const [path, elements] of Object.entries(meta.sets)) {
    const next: Record<string, ElementState> = {};
    for (const [element, state] of Object.entries(elements)) {
      const addHlc =
        state.addHlc !== null && state.addHlc > through ? state.addHlc : null;
      const removedLater =
        state.removeHlc !== null && state.removeHlc > through;
      if (addHlc === null && !removedLater) continue;
      next[element] = {
        addHlc,
        removeHlc: laterOrNull(state.removeHlc, through),
      };
    }
    sets[path] = next;
  }

  const maps: Record<string, Record<string, MapEntryState>> = {};
  for (const [path, entries] of Object.entries(meta.maps)) {
    const next: Record<string, MapEntryState> = {};
    for (const [key, state] of Object.entries(entries)) {
      if (state.hlc > through) next[key] = state;
    }
    maps[path] = next;
  }

  const created = meta.created && {
    hlc: meta.created.hlc,
    fields: Object.fromEntries(
      Object.entries(meta.created.fields).map(([field, value]) => [
        field,
        erase(field, value),
      ]),
    ),
  };

  // Unknown ops are kept verbatim for an upgrade, but an op at or before the delete describes
  // content the delete erased, so it goes too. Otherwise a `setAdd` this build cannot apply
  // would keep the tag ids of a deleted transaction.
  const unknown = meta.unknown.filter((op) => op.hlc > through);

  return {
    ...meta,
    erasedThrough: through,
    created,
    registers,
    sets,
    maps,
    unknown,
  };
}

/** Folds one op into an entity's causal state. Pure, commutative, and idempotent. */
export function applyOp(meta: CausalMeta | null, op: SyncOpBody): CausalMeta {
  const base = meta ?? emptyMeta(op.entityType, op.entityId, op.hlc);
  const advanced: CausalMeta = { ...base, maxHlc: maxHlc(base.maxHlc, op.hlc) };

  if (!isInterpretable(op)) {
    return eraseDeletedState(withUnknown(advanced, op));
  }

  return eraseDeletedState(applyKnownOp(advanced, op));
}

/**
 * Keeps an op this build cannot apply, so an upgrade can materialize it.
 *
 * Deduplicated by hlc + kind so a re-delivered batch does not grow the list forever, and sorted
 * rather than appended so that two devices which received the same unknown ops in different
 * orders still hold byte-identical state. Arrival order is not something either of them can
 * observe about the other.
 */
const withUnknown = (meta: CausalMeta, op: SyncOpBody): CausalMeta => {
  const seen = meta.unknown.some((each) => unknownKey(each) === unknownKey(op));
  return seen ? meta : { ...meta, unknown: sortUnknown([...meta.unknown, op]) };
};

function applyKnownOp(advanced: CausalMeta, op: SyncOpBody): CausalMeta {
  switch (op.kind) {
    case "create":
      return applyCreate(advanced, op);
    case "set":
      return applySet(advanced, op);
    case "setAdd":
    case "setRemove": {
      const path = String(op.payload.field ?? "");
      // A set this build does not know is kept whole, exactly like an unknown register.
      if (!elementSetsOf(op.entityType).includes(path))
        return withUnknown(advanced, op);
      const state: ElementState =
        op.kind === "setAdd"
          ? { addHlc: op.hlc, removeHlc: null }
          : { addHlc: null, removeHlc: op.hlc };
      const updates = Object.fromEntries(
        asStrings(op.payload.elements).map((element) => [element, state]),
      );
      return withElements(advanced, path, updates);
    }
    case "mapUpsert":
    case "mapRemove": {
      const path = String(op.payload.field ?? "");
      if (!keyedMapsOf(op.entityType).some((each) => each.path === path))
        return withUnknown(advanced, op);
      const updates: Record<string, MapEntryState> =
        op.kind === "mapUpsert"
          ? Object.fromEntries(
              Object.entries(asRecord(op.payload.entries)).map(
                ([key, value]) => [key, { hlc: op.hlc, value }],
              ),
            )
          : Object.fromEntries(
              asStrings(op.payload.keys).map((key) => [
                key,
                { hlc: op.hlc, value: null },
              ]),
            );
      return withMapEntries(advanced, path, updates);
    }
    case "delete": {
      const at =
        typeof op.payload.at === "string" ? op.payload.at : hlcToIso(op.hlc);
      return {
        ...withErasureAt(advanced, op.hlc),
        deleted: pickDeletion(advanced.deleted, { hlc: op.hlc, at }),
      };
    }
    case "restore":
      return {
        ...advanced,
        deleted: pickDeletion(advanced.deleted, { hlc: op.hlc, at: null }),
      };
    default:
      return advanced;
  }
}

function applyCreate(meta: CausalMeta, op: SyncOpBody): CausalMeta {
  const entity = asRecord(op.payload.entity);
  // Device-local fields are seeded here alongside the immutables. They are not merged and no
  // remote write can move them, but a device receiving an entity it has never held needs
  // *some* value or the projection is missing a field the model requires. `materialize`
  // overrides the seed with the local value the moment one exists.
  const pinned = [
    "id",
    "createdAt",
    ...createOnlyFieldsOf(op.entityType),
    ...deviceLocalFieldsOf(op.entityType),
  ];
  const fields = Object.fromEntries(
    pinned.map((field) => [field, readPath(entity, field) ?? null]),
  );

  // Two creates for the same id are ordinary, not a fault: §2.10 derives ids from the
  // occurrence key and the budget period precisely so that two devices generating the same
  // thing collide into one entity. The lower reading is canonical for the immutables — a
  // stable, arbitrary choice both devices reach independently — while the mutable registers
  // below merge by the usual rules, so the later create's edits still win.
  const created =
    !meta.created || op.hlc < meta.created.hlc
      ? { hlc: op.hlc, fields }
      : meta.created;

  let next: CausalMeta = { ...meta, created };

  for (const spec of registersOf(op.entityType)) {
    // A malformed sparse create must not erase fields a complete create already supplied. A
    // legacy-optional key (see `missingMeansNullOf`) is not sparseness: its absence is `null`.
    if (
      spec.fields.some(
        (field) =>
          readRegisteredPath(op.entityType, entity, field) === undefined,
      )
    )
      continue;
    next = withRegister(next, spec, {
      hlc: op.hlc,
      value: registerValueOf(spec, entity),
    });
  }
  for (const path of elementSetsOf(op.entityType)) {
    const updates = Object.fromEntries(
      elementsOf(entity, path).map((element) => [
        element,
        { addHlc: op.hlc, removeHlc: null },
      ]),
    );
    next = withElements(next, path, updates);
  }
  for (const { path, key } of keyedMapsOf(op.entityType)) {
    const updates = Object.fromEntries(
      Object.entries(mapEntriesOf(entity, path, key)).map(
        ([entryKey, value]) => [entryKey, { hlc: op.hlc, value }],
      ),
    );
    next = withMapEntries(next, path, updates);
  }

  // A tombstone converted by the genesis migration arrives as create-then-delete, but a
  // create that already carries `deletedAt` must not quietly lose it.
  const deletedAt = entity.deletedAt;
  if (typeof deletedAt === "string") {
    next = {
      ...withErasureAt(next, op.hlc),
      deleted: pickDeletion(next.deleted, { hlc: op.hlc, at: deletedAt }),
    };
  }
  return next;
}

function applySet(meta: CausalMeta, op: SyncOpBody): CausalMeta {
  const registers = asRecord(op.payload.registers);
  const known = new Map(
    registersOf(op.entityType).map((spec) => [spec.name, spec]),
  );
  let next = meta;
  for (const [name, value] of Object.entries(registers)) {
    const spec = known.get(name);
    if (!spec) {
      // A register this build does not know about, on a schema it claims to understand.
      // Keep it verbatim rather than discarding: a version that adds a field without
      // reshaping anything else is then a pure upgrade, and the value is already here.
      const incoming: RegisterState = { hlc: op.hlc, value };
      const existing = next.registers[name];
      if (!existing || incoming.hlc > existing.hlc) {
        next = { ...next, registers: { ...next.registers, [name]: incoming } };
      }
      continue;
    }
    next = withRegister(next, spec, { hlc: op.hlc, value: asRecord(value) });
  }
  return next;
}

/** Folds a batch. Ops may arrive in any order; the result does not depend on it. */
export function applyOps(
  metas: ReadonlyMap<string, CausalMeta>,
  ops: readonly SyncOpBody[],
): Map<string, CausalMeta> {
  const next = new Map(metas);
  for (const op of ops) {
    const key = metaKey(op.entityType, op.entityId);
    next.set(key, applyOp(next.get(key) ?? null, op));
  }
  return next;
}

// ---------------------------------------------------------------------------
// State-based merge, for a peer that fell behind the compaction watermark
// ---------------------------------------------------------------------------

/**
 * Merges two causal states directly, without ops.
 *
 * This is what a device receives when it has been away longer than the retention window
 * and the ops it missed are gone. It is emphatically *not* a last-writer-wins overwrite:
 * every slot goes through the same comparison `applyOp` uses, so a receiver holding newer
 * values for some registers keeps them and only takes what is genuinely ahead.
 */
export function mergeMeta(local: CausalMeta, remote: CausalMeta): CausalMeta {
  const specs = new Map(
    registersOf(local.entityType).map((spec) => [spec.name, spec]),
  );

  const registers: Record<string, RegisterState> = { ...local.registers };
  for (const [name, incoming] of Object.entries(remote.registers)) {
    const spec = specs.get(name);
    const existing = registers[name];
    registers[name] = spec
      ? pickRegister(spec, existing, incoming)
      : !existing || incoming.hlc > existing.hlc
        ? incoming
        : existing;
  }

  const sets: Record<string, Record<string, ElementState>> = {};
  for (const path of new Set([
    ...Object.keys(local.sets),
    ...Object.keys(remote.sets),
  ])) {
    const merged: Record<string, ElementState> = {
      ...(local.sets[path] ?? {}),
    };
    for (const [element, state] of Object.entries(remote.sets[path] ?? {})) {
      merged[element] = pickElement(merged[element], state);
    }
    sets[path] = merged;
  }

  const maps: Record<string, Record<string, MapEntryState>> = {};
  for (const path of new Set([
    ...Object.keys(local.maps),
    ...Object.keys(remote.maps),
  ])) {
    const merged: Record<string, MapEntryState> = {
      ...(local.maps[path] ?? {}),
    };
    for (const [key, state] of Object.entries(remote.maps[path] ?? {})) {
      merged[key] = pickMapEntry(merged[key], state);
    }
    maps[path] = merged;
  }

  const created =
    !local.created || (remote.created && remote.created.hlc < local.created.hlc)
      ? (remote.created ?? local.created)
      : local.created;

  const unknownByKey = new Map(
    [...local.unknown, ...remote.unknown].map((op) => [unknownKey(op), op]),
  );

  const erasedThrough = laterOrNull(
    erasureThreshold(local),
    erasureThreshold(remote),
  );

  return eraseDeletedState({
    entityType: local.entityType,
    entityId: local.entityId,
    maxHlc: maxHlc(local.maxHlc, remote.maxHlc),
    created,
    registers,
    sets,
    maps,
    deleted: remote.deleted
      ? pickDeletion(local.deleted, remote.deleted)
      : local.deleted,
    ...(erasedThrough === null ? {} : { erasedThrough }),
    unknown: sortUnknown([...unknownByKey.values()]),
  });
}

export function mergeMetaMaps(
  local: ReadonlyMap<string, CausalMeta>,
  remote: ReadonlyMap<string, CausalMeta>,
): Map<string, CausalMeta> {
  const next = new Map(local);
  for (const [key, incoming] of remote) {
    const existing = next.get(key);
    next.set(key, existing ? mergeMeta(existing, incoming) : incoming);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Fields the projection derives rather than merges; excluded when comparing for change. */
const DERIVED_FIELDS = ["revision", "updatedAt"] as const;

const withoutDerived = (entity: Record<string, unknown>) => {
  const copy = { ...entity };
  for (const field of DERIVED_FIELDS) delete copy[field];
  return copy;
};

/**
 * Projects causal state into the entity the repository and the UI read.
 *
 * Returns `null` when the `create` op has not arrived — registers may already have
 * accumulated from a `set` that overtook it, and writing a record without its immutable
 * fields would put a half-formed row in front of the user. Waiting is the fail-closed
 * choice, and the entity appears intact the moment the create lands.
 *
 * `previous` supplies `updatedAt`'s floor only. It is held monotone so that a merge cannot
 * make a record appear to travel backwards in a list sorted by it.
 *
 * `revision` is **not** settled here — see `finalize`. The projection is not what gets
 * written: the repair pass runs over the whole merged set first, and comparing before it
 * has had its say would bump the revision of every repaired record on every single merge,
 * forever, because the repair's output differs from the raw projection by construction.
 */
export function materialize(
  meta: CausalMeta,
  previous: FinanceEntity | null,
): FinanceEntity | null {
  if (!meta.created) return null;

  let entity: Record<string, unknown> = { ...meta.created.fields };

  for (const spec of registersOf(meta.entityType)) {
    const state = meta.registers[spec.name];
    if (!state) continue;
    const value = state.value as RegisterValue;
    for (const field of spec.fields) {
      if (!(field in value)) continue;
      entity = writePath(entity, field, value[field]);
    }
  }

  for (const path of elementSetsOf(meta.entityType)) {
    // Sorted, because two devices must agree byte-for-byte on the projection and insertion
    // order is not something either of them can observe about the other.
    const elements = Object.entries(meta.sets[path] ?? {})
      .filter(([, state]) => isElementPresent(state))
      .map(([element]) => element)
      .sort();
    entity = writePath(entity, path, elements);
  }

  for (const { path } of keyedMapsOf(meta.entityType)) {
    const entries = Object.entries(meta.maps[path] ?? {})
      .filter(([, state]) => state.value !== null)
      .sort(([first], [second]) =>
        first < second ? -1 : first > second ? 1 : 0,
      )
      .map(([, state]) => state.value);
    entity = writePath(entity, path, entries);
  }

  // The local value of a device-local field always wins. Without this, the first remote edit
  // to any *other* settings field would project a `themeMode` seeded from whichever device
  // happened to write the create — so editing the locale on a phone would drag a laptop out
  // of dark mode. The seed is only ever used by a device that holds no copy at all.
  for (const field of deviceLocalFieldsOf(meta.entityType)) {
    const local = previous ? readPath(previous, field) : undefined;
    if (local !== undefined) entity = writePath(entity, field, local);
  }

  entity.deletedAt = meta.deleted?.at ?? null;

  const stamp = hlcToIso(meta.maxHlc);
  entity.updatedAt =
    previous && previous.updatedAt > stamp ? previous.updatedAt : stamp;
  entity.revision = previous?.revision ?? 1;

  // A tombstone projects erased, including the fields `eraseDeletedState` has to leave alone
  // and any edit that arrived after the delete.
  return eraseEntity(meta.entityType, entity as unknown as FinanceEntity);
}

export interface Finalized {
  readonly entity: FinanceEntity;
  /** False when nothing but the derived fields moved, so the caller can skip the write. */
  readonly changed: boolean;
}

/**
 * Settles `revision` against what is actually stored, after the repair pass has run.
 *
 * `revision` exists only for optimistic concurrency *inside* this device: every form
 * captures it when it opens and `assertExpectedRevision` compares it against the local
 * snapshot. It is never compared across devices, which is why it is safe — and necessary —
 * for it to be strictly locally monotone rather than merged. A stale form is then always
 * rejected, whether the newer write came from this device or another one.
 */
export function finalize(
  next: FinanceEntity,
  previous: FinanceEntity | null,
): Finalized {
  if (previous) {
    const before = canonicalJson(
      withoutDerived(previous as unknown as Record<string, unknown>),
    );
    const after = canonicalJson(
      withoutDerived(next as unknown as Record<string, unknown>),
    );
    // Returning `previous` verbatim rather than a fresh equal object keeps `updatedAt`
    // pinned to when the record last genuinely changed, instead of creeping forward every
    // time an unrelated op advances this entity's clock.
    if (before === after) return { entity: previous, changed: false };
  }
  return {
    entity: { ...next, revision: (previous?.revision ?? 0) + 1 },
    changed: true,
  };
}

/** The entity types a batch touched, so the caller can hydrate only what moved. */
export function changedTypes(ops: readonly SyncOpBody[]): EntityType[] {
  const types = new Set<EntityType>();
  for (const op of ops)
    if (isEntityType(op.entityType)) types.add(op.entityType);
  return [...types].sort();
}
