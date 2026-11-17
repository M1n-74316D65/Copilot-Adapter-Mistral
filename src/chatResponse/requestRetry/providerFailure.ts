import { getErrorMessage, getErrorName, getStatusCode } from '../../assertions/index.js';
import { StreamStalledError } from './streamGuard.js';

/**
 * Failure classification ported from mistral-vibe's
 * `adapters/_provider_failure.py`. Retryable HTTP statuses are exactly vibe's
 * set (520 = edge proxy couldn't relay the origin, 529 = overloaded).
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set( [ 408, 409, 425, 429, 500, 502, 503, 504, 520, 529 ] );

export interface ProviderFailure {
    readonly retryable: boolean;
    readonly stalled: boolean;
    /** Server-requested wait from a Retry-After header, when present. */
    readonly retryAfterMs?: number;
}

const TRANSPORT_ERROR_PATTERN = /timeout|timed out|network|econn|enotfound|socket|fetch failed|epipe|UND_ERR/i;
const TLS_ERROR_PATTERN = /certificate|CERT_|SSL|TLS|hostname/i;

export function readProviderFailure ( error: unknown, signal?: AbortSignal ): ProviderFailure {
    const name = getErrorName( error ) ?? ``;
    if ( signal?.aborted || name === `AbortError` || name === `CancelledError` ) {
        return { retryable: false, stalled: false };
    }
    if ( error instanceof StreamStalledError ) {
        return { retryable: true, stalled: true };
    }
    const status = getStatusCode( error );
    if ( typeof status === `number` ) {
        return {
            retryable: RETRYABLE_STATUSES.has( status ),
            stalled: false,
            retryAfterMs: status === 429 ? readRetryAfterHeader( error ) : undefined,
        };
    }
    const message = getErrorMessage( error ) ?? ``;
    if ( TLS_ERROR_PATTERN.test( name + ` ` + message ) ) {
        // A rejected certificate fails every attempt identically.
        return { retryable: false, stalled: false };
    }
    if ( TRANSPORT_ERROR_PATTERN.test( name + ` ` + message ) ) {
        return { retryable: true, stalled: false };
    }
    return { retryable: false, stalled: false };
}

function readRetryAfterHeader ( error: unknown ): number | undefined {
    if ( typeof error !== `object` || error === null ) {
        return undefined;
    }
    const headers = ( error as Record<string, unknown> )[ `headers` ];
    const get = ( headers as { get?: ( name: string ) => string | null | undefined } | undefined )?.get?.bind( headers );
    const header = get ? get( `retry-after` ) : undefined;
    if ( !header ) {
        return undefined;
    }
    const seconds = Number( header );
    if ( Number.isFinite( seconds ) ) {
        return seconds > 0 ? seconds * 1000 : undefined;
    }
    const dateMs = Date.parse( header );
    if ( Number.isNaN( dateMs ) ) {
        return undefined;
    }
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : undefined;
}
