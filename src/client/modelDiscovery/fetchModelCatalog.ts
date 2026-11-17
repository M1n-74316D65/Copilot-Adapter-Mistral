import { workspace } from 'vscode';
import type { KnownModelCard } from './knownModelCard.js';

/**
 * Client for Mistral's `/model-catalog` endpoint, ported from mistral-vibe's
 * `vibe/core/model_catalog/` (path `?surface=vibe-code`, 5s per-phase timeout,
 * 30-day cache, tolerant per-entry parse, fail-open to cache). Only entries
 * with `capabilities.function_calling` are kept, as in vibe.
 */

export const MODEL_CATALOG_PATH = `/model-catalog`;
export const MODEL_CATALOG_SURFACE = `vibe-code`;
export const MODEL_CATALOG_TIMEOUT_MS = 5000;
export const MODEL_CATALOG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MODEL_CATALOG_CACHE_KEY = `mistral.modelCatalog.v1`;

export const DEFAULT_API_BASE_URL = `https://api.mistral.ai`;

export interface CatalogCacheStore {
    get: ( key: string ) => unknown;
    update: ( key: string, value: unknown ) => Promise<unknown> | unknown;
}

export interface CatalogLogger {
    debug: ( message: string ) => void;
    warn: ( message: string ) => void;
}

interface CatalogEntry {
    id?: unknown;
    label?: unknown;
    aliases?: unknown;
    description?: unknown;
    max_context_length?: unknown;
    capabilities?: unknown;
    parameters?: unknown;
}

/** Builds the catalog URL from a configured base URL, stripping any /v1 suffix. */
export function buildModelCatalogUrl ( baseUrl: string | undefined ): string | undefined {
    const apiBase = ( baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_API_BASE_URL )
        .trim().replace( /\/+$/, `` ).replace( /\/v1$/, `` );
    if ( !apiBase ) {
        return undefined;
    }
    return `${ apiBase }${ MODEL_CATALOG_PATH }?surface=${ MODEL_CATALOG_SURFACE }`;
}

/**
 * Tolerantly parses a catalog payload: entries missing `id` or `label` are
 * dropped, unknown fields ignored, and only function-calling chat models are
 * kept (mirrors vibe's capability filter).
 */
export function parseModelCatalog ( payload: unknown ): KnownModelCard[] {
    const data = ( payload as { data?: unknown } )?.data ?? payload;
    if ( !Array.isArray( data ) ) {
        return [];
    }
    const cards: KnownModelCard[] = [];
    for ( const entry of data ) {
        if ( typeof entry !== `object` || entry === null ) {
            continue;
        }
        const candidate = entry as CatalogEntry;
        if ( typeof candidate.id !== `string` || candidate.id.trim().length === 0 ||
            typeof candidate.label !== `string` || candidate.label.trim().length === 0 ) {
            continue;
        }
        const capabilities = ( candidate.capabilities ?? {} ) as Record<string, unknown>;
        if ( capabilities[ `function_calling` ] !== true || capabilities[ `completion_chat` ] !== true ) {
            continue;
        }
        const parameters = ( candidate.parameters ?? {} ) as Record<string, unknown>;
        const maxContext = typeof candidate.max_context_length === `number` && Number.isSafeInteger( candidate.max_context_length ) && candidate.max_context_length > 0
            ? candidate.max_context_length
            : undefined;
        const temperature = typeof parameters[ `temperature` ] === `number` ? parameters[ `temperature` ] : undefined;
        cards.push( {
            id: candidate.id,
            name: candidate.label,
            description: typeof candidate.description === `string` ? candidate.description : undefined,
            aliases: Array.isArray( candidate.aliases ) ? candidate.aliases.filter( ( a ): a is string => {
                return typeof a === `string` && a.length > 0;
            } ) : undefined,
            maxContextLength: maxContext,
            capabilities: {
                functionCalling: true,
                completionChat: true,
                vision: capabilities[ `vision` ] === true,
                reasoning: Array.isArray( parameters[ `reasoning` ] ) && parameters[ `reasoning` ].length > 0,
            },
            defaultModelTemperature: temperature,
        } as unknown as KnownModelCard );
    }
    return cards;
}

interface CachedCatalog {
    fetchedAt: number;
    entries: unknown;
}

/**
 * Fetches the model catalog with a 5s timeout, caching the raw payload for 30
 * days. On failure, falls back to the cached payload (even stale); returns
 * undefined when nothing is available so callers can fall back to /v1/models.
 */
export async function fetchModelCatalog (
    log: CatalogLogger,
    cache?: CatalogCacheStore,
    now: () => number = () => {
        return Date.now();
    },
): Promise<KnownModelCard[] | undefined> {
    const url = buildModelCatalogUrl( workspace.getConfiguration( `mistral` ).get<string>( `baseUrl` ) );
    if ( !url ) {
        return undefined;
    }
    try {
        const response = await fetch( url, { signal: AbortSignal.timeout( MODEL_CATALOG_TIMEOUT_MS ) } );
        if ( !response.ok ) {
            throw new Error( `catalog returned HTTP ${ response.status }` );
        }
        const payload = await response.json();
        const cards = parseModelCatalog( payload );
        if ( cache ) {
            await cache.update( MODEL_CATALOG_CACHE_KEY, { fetchedAt: now(), entries: payload } satisfies CachedCatalog );
        }
        log.debug( `[Mistral] Fetched model catalog: ${ cards.length } function-calling chat model(s).` );
        return cards;
    } catch ( error ) {
        log.warn( `[Mistral] Model catalog fetch failed (${ error instanceof Error ? error.message : String( error ) }); trying cache.` );
        const cached = cache?.get( MODEL_CATALOG_CACHE_KEY ) as CachedCatalog | undefined;
        if ( cached && cached.entries ) {
            const ageMs = now() - ( typeof cached.fetchedAt === `number` ? cached.fetchedAt : 0 );
            if ( ageMs <= MODEL_CATALOG_CACHE_TTL_MS ) {
                const cards = parseModelCatalog( cached.entries );
                log.debug( `[Mistral] Using cached model catalog (${ cards.length } models, age ${ Math.round( ageMs / 3600000 ) }h).` );
                return cards;
            }
        }
        return undefined;
    }
}
