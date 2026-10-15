/**
 * Where the stocked Discover sets live: Netlify Blobs "discover" store,
 * one index per list (`stock/shared/index`, `stock/owner/index`, see
 * ./stock) and one blob per set (`stock/set/<id>`). Written only by the
 * owner-gated upload during /refresh-earclef; read by the Discover
 * routes. Local dev (no Blobs context) keeps it in process memory.
 */
import { randomBytes } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import type { OwnerIndex, SharedIndex } from './stock'
import type { DiscoverPick, StockKind } from './types'

export interface StockSet {
  id: string
  kind: StockKind
  picks: DiscoverPick[]
  createdAt: string
}

type IndexFor<K extends StockKind> = K extends 'shared' ? SharedIndex : OwnerIndex

const dev = globalThis as unknown as { __earclefDevStock?: Map<string, unknown> }
const devStock = (dev.__earclefDevStock ??= new Map())

function store() {
  return getStore({ name: 'discover', consistency: 'strong' })
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    return ((await store().get(key, { type: 'json' })) ?? null) as T | null
  } catch {
    return (devStock.get(key) as T | undefined) ?? null
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await store().setJSON(key, value)
  } catch {
    devStock.set(key, value)
  }
}

const indexKey = (kind: StockKind) => `stock/${kind}/index`
const setKey = (id: string) => `stock/set/${id}`

export function readIndex<K extends StockKind>(kind: K): Promise<IndexFor<K> | null> {
  return readJson<IndexFor<K>>(indexKey(kind))
}

export function writeIndex<K extends StockKind>(kind: K, index: IndexFor<K>): Promise<void> {
  return writeJson(indexKey(kind), index)
}

export function readSet(id: string): Promise<StockSet | null> {
  return readJson<StockSet>(setKey(id))
}

export function writeSet(set: StockSet): Promise<void> {
  return writeJson(setKey(set.id), set)
}

export async function readSets(ids: readonly string[]): Promise<StockSet[]> {
  const sets = await Promise.all([...new Set(ids)].map(readSet))
  return sets.filter((set): set is StockSet => set !== null)
}

export async function deleteSets(ids: readonly string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      try {
        await store().delete(setKey(id))
      } catch {
        devStock.delete(setKey(id))
      }
    }),
  )
}

export function newSetId(kind: StockKind, today: string): string {
  return `${kind}-${today}-${randomBytes(4).toString('hex')}`
}
