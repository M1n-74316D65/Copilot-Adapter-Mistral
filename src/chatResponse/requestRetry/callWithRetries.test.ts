import { describe, expect, it, vi } from 'vitest';
import { callWithRetries } from './callWithRetries.js';
import { readProviderFailure, RETRYABLE_STATUSES } from './providerFailure.js';
import { guardStream, StreamStalledError } from './streamGuard.js';

const log = { warn: vi.fn(), debug: vi.fn() };
const noSleep = () => {
    return Promise.resolve();
};

function statusError ( statusCode: number, headers?: Record<string, string> ): Error {
    const error = new Error( `status ${ statusCode }` ) as Error & { statusCode: number; headers?: Headers };
    error.statusCode = statusCode;
    if ( headers ) {
        error.headers = new Headers( headers );
    }
    return error;
}

describe( `readProviderFailure`, () => {
    it( `marks vibe's retryable statuses retryable`, () => {
        for ( const status of RETRYABLE_STATUSES ) {
            expect( readProviderFailure( statusError( status ) ).retryable ).toBe( true );
        }
    } );

    it( `marks 400/401/403/404 as non-retryable`, () => {
        for ( const status of [ 400, 401, 403, 404, 422 ] ) {
            expect( readProviderFailure( statusError( status ) ).retryable ).toBe( false );
        }
    } );

    it( `extracts Retry-After on 429`, () => {
        const failure = readProviderFailure( statusError( 429, { 'retry-after': `5` } ) );
        expect( failure.retryable ).toBe( true );
        expect( failure.retryAfterMs ).toBe( 5000 );
    } );

    it( `treats stalls as retryable and flagged`, () => {
        const failure = readProviderFailure( new StreamStalledError( `stalled` ) );
        expect( failure.retryable ).toBe( true );
        expect( failure.stalled ).toBe( true );
    } );

    it( `treats transport errors as retryable but not stalled`, () => {
        const error = new Error( `fetch failed` );
        error.name = `TypeError`;
        expect( readProviderFailure( error ) ).toEqual( { retryable: true, stalled: false, retryAfterMs: undefined } );
    } );

    it( `treats TLS certificate errors as non-retryable`, () => {
        const error = new Error( `CERT_HAS_EXPIRED` );
        expect( readProviderFailure( error ).retryable ).toBe( false );
    } );

    it( `treats aborts as non-retryable`, () => {
        const error = new Error( `aborted` );
        error.name = `AbortError`;
        expect( readProviderFailure( error ).retryable ).toBe( false );
        const signal = new AbortController().signal;
        expect( readProviderFailure( new Error( `x` ), signal ).retryable ).toBe( false );
    } );
} );

describe( `callWithRetries`, () => {
    it( `returns the first successful attempt without sleeping`, async () => {
        const sleep = vi.fn();
        const result = await callWithRetries( () => {
            return Promise.resolve( 42 );
        }, { log, sleep, now: () => {
            return 0;
        } } );
        expect( result ).toBe( 42 );
        expect( sleep ).not.toHaveBeenCalled();
    } );

    it( `retries a retryable failure then succeeds`, async () => {
        let calls = 0;
        const result = await callWithRetries( () => {
            calls += 1;
            return calls === 1 ? Promise.reject( statusError( 503 ) ) : Promise.resolve( `ok` );
        }, { log, sleep: noSleep, now: () => {
            return 0;
        } } );
        expect( result ).toBe( `ok` );
        expect( calls ).toBe( 2 );
    } );

    it( `does not retry a non-retryable status`, async () => {
        let calls = 0;
        await expect( callWithRetries( () => {
            calls += 1;
            return Promise.reject( statusError( 401 ) );
        }, { log, sleep: noSleep, now: () => {
            return 0;
        } } ) ).rejects.toThrow( `status 401` );
        expect( calls ).toBe( 1 );
    } );

    it( `gives the stall exactly one exempt retry`, async () => {
        let calls = 0;
        await expect( callWithRetries( () => {
            calls += 1;
            return Promise.reject( new StreamStalledError( `stalled` ) );
        }, { log, sleep: noSleep, now: () => {
            return 0;
        } } ) ).rejects.toThrow( StreamStalledError );
        expect( calls ).toBe( 2 );
    } );

    it( `stops starting new attempts once the elapsed budget is spent`, async () => {
        let calls = 0;
        await expect( callWithRetries( () => {
            calls += 1;
            return Promise.reject( statusError( 500 ) );
        }, { log, sleep: noSleep, now: () => {
            return 0;
        }, maxElapsedMs: 500, random: () => {
            return 0;
        } } ) ).rejects.toThrow();
        expect( calls ).toBe( 1 );
    } );

    it( `honours the server-requested Retry-After wait`, async () => {
        const sleep = vi.fn().mockImplementation( noSleep );
        let calls = 0;
        await callWithRetries( () => {
            calls += 1;
            return calls === 1 ? Promise.reject( statusError( 429, { 'retry-after': `7` } ) ) : Promise.resolve( `ok` );
        }, { log, sleep, now: () => {
            return 0;
        }, random: () => {
            return 0;
        } } );
        expect( sleep ).toHaveBeenCalledWith( 7000 );
    } );

    it( `rethrows immediately when the signal is aborted`, async () => {
        const controller = new AbortController();
        controller.abort();
        let calls = 0;
        await expect( callWithRetries( () => {
            calls += 1;
            return Promise.reject( statusError( 503 ) );
        }, { log, sleep: noSleep, signal: controller.signal } ) ).rejects.toThrow();
        expect( calls ).toBe( 1 );
    } );
} );

describe( `guardStream`, () => {
    async function* events ( items: number[], delayMs: number ): AsyncGenerator<number> {
        for ( const item of items ) {
            await new Promise( resolve => {
                return setTimeout( resolve, delayMs );
            } );
            yield item;
        }
    }

    it( `passes all events through when they arrive in time`, async () => {
        const seen: number[] = [];
        for await ( const event of guardStream( events( [ 1, 2, 3 ], 1 ), undefined, log ) ) {
            seen.push( event );
        }
        expect( seen ).toEqual( [ 1, 2, 3 ] );
    } );

    it( `throws StreamStalledError when the first event exceeds the first-output wait`, async () => {
        const slow = guardStream( events( [ 1 ], 100 ), undefined, log, { firstOutputMs: 20 } );
        await expect( async () => {
            for await ( const _ of slow ) {
                void _;
            }
        } ).rejects.toThrow( StreamStalledError );
    } );

    it( `throws StreamStalledError on an idle gap after the first event`, async () => {
        async function* custom (): AsyncGenerator<number> {
            yield 1;
            await new Promise( resolve => {
                return setTimeout( resolve, 100 );
            } );
            yield 2;
        }
        await expect( async () => {
            for await ( const _ of guardStream( custom(), undefined, log, { firstOutputMs: 1000, idleMs: 20 } ) ) {
                void _;
            }
        } ).rejects.toThrow( StreamStalledError );
    } );
} );
