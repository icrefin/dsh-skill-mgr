/**
 * The `skillMgr` Remote descriptors.
 *
 * One table drives both published artifacts: `typert.host.ts` wraps it as the
 * host `TYPERT` manifest (what `dsh-typert-loader` registers), and
 * `typert.remote-client.ts` wraps it as the `TYPERT_REMOTE` contribution the
 * browser half mounts with `ctx.remote.$mount`. Because the descriptors are
 * shared, the two faces cannot disagree about a wire name or a codec — the
 * failure mode the dsh pipeline guards against by regenerating both from one
 * FaceModel.
 *
 * Remote hardening rules this table follows, all enforced by the runtime:
 * - every parameter and result codec is `mode: 'strict'` with a `typeSymbol`
 *   and a `create()` factory (`dsh-typert-loader` rejects anything else);
 * - every parameter carries a unique `wire` name and is `source: 'json'`;
 * - the invocation id is `<package>#<namespace>/<method>` and the namespace
 *   equals the Cordis service key, so the client reads it back as
 *   `ctx.get('remote.skillMgr')`.
 *
 * @module dsh-skill-mgr/typert.descriptors
 */

import type { InvocationDescriptor, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import * as wire from './wire.ts'

/** npm package that owns the Remote methods. */
export const PACKAGE_NAME = 'dsh-skill-mgr'

/** Wire namespace and Cordis service key of the management gateway. */
export const REMOTE_NAMESPACE = 'skillMgr'

/** One business parameter of a Remote method. */
interface ParamSpec {
  /** Source-level parameter name (also the wire key). */
  readonly name: string
  /** Published type identity of the codec. */
  readonly type: string
  /** Boundary schema. */
  readonly schema: z.ZodType
}

/** One Remote method. */
interface MethodSpec {
  readonly method: string
  readonly params: readonly ParamSpec[]
  readonly result: { readonly type: string; readonly schema: z.ZodType }
}

/** Wrap a schema as the strict codec the runtime requires. */
function codec(typeSymbol: string, schema: z.ZodType): TypertCodec {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

/** Shortcut: a parameter whose schema is an ad-hoc primitive. */
function param(name: string, schema: z.ZodType): ParamSpec {
  return { name, type: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${name}`, schema }
}

/** Shortcut: a parameter whose schema is a published named type. */
function typed(name: string, type: string, schema: z.ZodType): ParamSpec {
  return { name, type: `${PACKAGE_NAME}/types#${type}`, schema }
}

/** Shortcut: a published named result type. */
const metric = (type: string, schema: z.ZodType) => ({ type: `${PACKAGE_NAME}/types#${type}`, schema })

/**
 * Every method the panel can call, in the order the host class declares them.
 *
 * The naming follows dsh-mcp-mgr exactly: `snapshot` reads the whole management
 * view, `save*`/`remove*`/`set*Enabled` write one entity, the trash methods
 * restore or empty it, and every write answers `SkillApplyResult`.
 */
const METHODS: readonly MethodSpec[] = [
  /* ---- core ---- */
  { method: 'snapshot', params: [], result: metric('SkillManagerSnapshot', wire.SkillManagerSnapshot) },

  /* ---- profile inventory ---- */
  { method: 'saveGlobalSkill', params: [typed('draft', 'SkillDraft', wire.SkillDraft)], result: metric('SkillApplyResult', wire.SkillApplyResult) },
  { method: 'removeGlobalSkill', params: [param('name', z.string())], result: metric('SkillApplyResult', wire.SkillApplyResult) },
  {
    method: 'setGlobalSkillEnabled',
    params: [param('name', z.string()), param('enabled', z.boolean())],
    result: metric('SkillApplyResult', wire.SkillApplyResult),
  },
  { method: 'skillDetail', params: [param('name', z.string())], result: metric('SkillDetailResult', wire.SkillDetailResult) },
  { method: 'fixDiagnostic', params: [param('path', z.string())], result: metric('DiagnosticFixResult', wire.DiagnosticFixResult) },
  { method: 'skillStats', params: [], result: metric('SkillStatsResult', wire.SkillStatsResult) },

  /* ---- trash ---- */
  { method: 'restoreTrashedSkill', params: [param('name', z.string())], result: metric('TrashRestoreResult', wire.TrashRestoreResult) },
  { method: 'clearTrash', params: [], result: metric('TrashClearResult', wire.TrashClearResult) },
]

/** Build the wire descriptor for one method spec. */
function descriptorOf(spec: MethodSpec): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#${REMOTE_NAMESPACE}/${spec.method}`,
    service: REMOTE_NAMESPACE,
    namespace: REMOTE_NAMESPACE,
    method: spec.method,
    invocation: { kind: 'direct' },
    parameters: spec.params.map((entry) => ({
      name: entry.name,
      wire: entry.name,
      source: 'json' as const,
      codec: codec(entry.type, entry.schema),
    })),
    result: codec(spec.result.type, spec.result.schema),
  }
}

/** Every invocation descriptor, host and client face alike. */
export const DESCRIPTORS: readonly InvocationDescriptor[] = METHODS.map(descriptorOf)

/** The contribution the browser half mounts. */
export const REMOTE_CONTRIBUTION: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: DESCRIPTORS,
}

/**
 * Shape of the host-face manifest `dsh-typert-loader` validates and hands to
 * `ctx.typert.register`. The service/event/object inventories stay empty: this
 * package contributes Remote methods, not a Cordis catalog.
 */
export interface TypertHostManifest {
  readonly package: string
  readonly face: 'host'
  readonly schemas: readonly unknown[]
  readonly invocations: readonly InvocationDescriptor[]
  readonly model: {
    readonly services: readonly unknown[]
    readonly events: readonly unknown[]
    readonly objects: readonly unknown[]
  }
}

/** The host manifest. */
export const HOST_MANIFEST: TypertHostManifest = {
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  invocations: DESCRIPTORS,
  model: { services: [], events: [], objects: [] },
}