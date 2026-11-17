import { describe, expect, it, vi } from 'vitest';
import { workspace } from '../test/vscode.mock.js';
import { initClient } from './initClient.js';
import type { AuthDeps } from './authDeps.js';

function makeDeps (storedKey: string | undefined): AuthDeps & { setClient: ReturnType<typeof vi.fn> } {
    const setClient = vi.fn();
    return {
        context: { secrets: { get: vi.fn().mockResolvedValue(storedKey) } },
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
        getClient: vi.fn().mockReturnValue(undefined),
        setClient: setClient as never,
        invalidateModelCache: vi.fn(),
        fireModelInfoChange: vi.fn(),
    } as never;
}

function setApiKeyConfig (value: string | undefined): void {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockImplementation((key: string) => {
            return key === `apiKey` ? value : undefined;
        }),
        update: vi.fn(),
    } as never);
}

describe(`initClient`, () => {
    it(`uses the stored secret when present`, async () => {
        setApiKeyConfig(undefined);
        const deps = makeDeps(`stored-key-1234567890`);
        expect(await initClient(true, deps)).toBe(true);
        expect(deps.setClient).toHaveBeenCalled();
    });

    it(`falls back to the mistral.apiKey setting when no secret is stored`, async () => {
        setApiKeyConfig(`config-key-1234567890`);
        const deps = makeDeps(undefined);
        expect(await initClient(true, deps)).toBe(true);
        expect(deps.setClient).toHaveBeenCalled();
    });

    it(`returns false when neither secret nor setting is available (silent)`, async () => {
        setApiKeyConfig(undefined);
        const deps = makeDeps(undefined);
        expect(await initClient(true, deps)).toBe(false);
        expect(deps.setClient).not.toHaveBeenCalled();
    });

    it(`prefers the stored secret over the setting`, async () => {
        setApiKeyConfig(`config-key-1234567890`);
        const deps = makeDeps(`stored-key-1234567890`);
        expect(await initClient(true, deps)).toBe(true);
        expect(deps.setClient).toHaveBeenCalled();
    });
});
