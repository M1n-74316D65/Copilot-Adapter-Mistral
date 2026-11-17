import { describe, expect, it } from 'vitest';
import { parsePersistedIndex } from './codebaseIndex.js';

function validChunk () {
    return { file: `a.ts`, startLine: 1, endLine: 3, text: `const x = 1;`, vector: [ 0.1, 0.2 ] };
}

describe(`parsePersistedIndex`, () => {
    it(`accepts a well-formed index`, () => {
        const parsed = parsePersistedIndex({
            model: `codestral-embed`,
            files: { 'a.ts': { hash: `h`, chunks: [ validChunk() ] } },
        });
        expect(parsed).not.toBeNull();
        expect(parsed?.files[`a.ts`].chunks).toHaveLength(1);
    });

    it(`rejects non-object payloads`, () => {
        expect(parsePersistedIndex(null)).toBeNull();
        expect(parsePersistedIndex(`str`)).toBeNull();
        expect(parsePersistedIndex(42)).toBeNull();
    });

    it(`rejects missing model or files`, () => {
        expect(parsePersistedIndex({ files: {} })).toBeNull();
        expect(parsePersistedIndex({ model: `m` })).toBeNull();
    });

    it(`rejects malformed file entries`, () => {
        expect(parsePersistedIndex({ model: `m`, files: { 'a.ts': { hash: 5, chunks: [] } } })).toBeNull();
        expect(parsePersistedIndex({ model: `m`, files: { 'a.ts': { hash: `h`, chunks: `nope` } } })).toBeNull();
    });

    it(`rejects malformed chunks and non-numeric vectors`, () => {
        expect(
            parsePersistedIndex({
                model: `m`,
                files: { 'a.ts': { hash: `h`, chunks: [ { ...validChunk(), vector: [ 0.1, `x` ] } ] } },
            }),
        ).toBeNull();
        expect(
            parsePersistedIndex({
                model: `m`,
                files: { 'a.ts': { hash: `h`, chunks: [ { ...validChunk(), startLine: `1` } ] } },
            }),
        ).toBeNull();
    });

    it(`rejects oversized vectors`, () => {
        const big = Array.from({ length: 5000 }, () => {
            return 0.1;
        });
        expect(
            parsePersistedIndex({
                model: `m`,
                files: { 'a.ts': { hash: `h`, chunks: [ { ...validChunk(), vector: big } ] } },
            }),
        ).toBeNull();
    });

    it(`rejects too many files`, () => {
        const files: Record<string, unknown> = {};
        for (let i = 0; i < 5001; i++) {
            files[`f${i}.ts`] = { hash: `h`, chunks: [] };
        }
        expect(parsePersistedIndex({ model: `m`, files })).toBeNull();
    });
});
