import { describe, expect, it, vi } from 'vitest';
import { buildModelCatalogUrl, parseModelCatalog, fetchModelCatalog, MODEL_CATALOG_CACHE_KEY, MODEL_CATALOG_CACHE_TTL_MS } from './fetchModelCatalog.js';

const log = { debug: vi.fn(), warn: vi.fn() };

describe( `buildModelCatalogUrl`, () => {
    it( `builds the vibe-code surface URL on the default base`, () => {
        expect( buildModelCatalogUrl( undefined ) ).toBe( `https://api.mistral.ai/model-catalog?surface=vibe-code` );
    } );

    it( `strips a trailing /v1 from a configured base URL`, () => {
        expect( buildModelCatalogUrl( `https://proxy.example.com/v1/` ) ).toBe( `https://proxy.example.com/model-catalog?surface=vibe-code` );
    } );
} );

describe( `parseModelCatalog`, () => {
    it( `keeps only function-calling chat models with id and label`, () => {
        const cards = parseModelCatalog( { data: [
            { id: `mistral-large-4`, label: `Mistral Large`, capabilities: { function_calling: true, completion_chat: true }, parameters: { reasoning: [ `low`, `high` ], temperature: 0.2 } },
            { id: `embed`, label: `Embed`, capabilities: { function_calling: false, completion_chat: false } },
            { id: `chat-no-tools`, label: `No tools`, capabilities: { function_calling: false, completion_chat: true } },
            { label: `missing id` },
            { id: `missing-label` },
            `garbage`,
        ] } );
        expect( cards ).toHaveLength( 1 );
        expect( cards[ 0 ].id ).toBe( `mistral-large-4` );
        expect( ( cards[ 0 ] as unknown as { capabilities: { reasoning: boolean } } ).capabilities.reasoning ).toBe( true );
    } );

    it( `accepts a bare array payload and returns empty for malformed payloads`, () => {
        expect( parseModelCatalog( [ { id: `a`, label: `A`, capabilities: { function_calling: true, completion_chat: true } } ] ) ).toHaveLength( 1 );
        expect( parseModelCatalog( { nope: true } ) ).toEqual( [] );
        expect( parseModelCatalog( null ) ).toEqual( [] );
    } );
} );

describe( `fetchModelCatalog`, () => {
    it( `returns parsed cards and writes the cache on success`, async () => {
        const update = vi.fn();
        const store = { get: vi.fn(), update };
        vi.stubGlobal( `fetch`, vi.fn().mockResolvedValue( {
            ok: true,
            json: () => {
                return Promise.resolve( { data: [ { id: `m`, label: `M`, capabilities: { function_calling: true, completion_chat: true } } ] } );
            },
        } ) );
        const cards = await fetchModelCatalog( log, store, () => {
            return 1000;
        } );
        expect( cards ).toHaveLength( 1 );
        expect( update ).toHaveBeenCalledWith( MODEL_CATALOG_CACHE_KEY, expect.objectContaining( { fetchedAt: 1000 } ) );
        vi.unstubAllGlobals();
    } );

    it( `falls back to a fresh cache entry when the fetch fails`, async () => {
        const entries = { data: [ { id: `cached`, label: `C`, capabilities: { function_calling: true, completion_chat: true } } ] };
        const store = { get: vi.fn().mockReturnValue( { fetchedAt: 500, entries } ), update: vi.fn() };
        vi.stubGlobal( `fetch`, vi.fn().mockRejectedValue( new Error( `offline` ) ) );
        const cards = await fetchModelCatalog( log, store, () => {
            return 500 + MODEL_CATALOG_CACHE_TTL_MS - 1;
        } );
        expect( cards?.map( c => {
            return c.id;
        } ) ).toEqual( [ `cached` ] );
        vi.unstubAllGlobals();
    } );

    it( `returns undefined when the fetch fails and the cache is stale or absent`, async () => {
        vi.stubGlobal( `fetch`, vi.fn().mockRejectedValue( new Error( `offline` ) ) );
        const store = { get: vi.fn().mockReturnValue( { fetchedAt: 0, entries: { data: [] } } ), update: vi.fn() };
        expect( await fetchModelCatalog( log, store, () => {
            return MODEL_CATALOG_CACHE_TTL_MS + 1;
        } ) ).toBeUndefined();
        expect( await fetchModelCatalog( log, undefined ) ).toBeUndefined();
        vi.unstubAllGlobals();
    } );
} );
