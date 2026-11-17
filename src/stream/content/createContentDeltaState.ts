import type { ContentDeltaState } from './contentDeltaState.js';

export function createContentDeltaState ( thinkingEnabled = true ): ContentDeltaState {
    return { thinkDepth: 0, pendingText: ``, thinkingEnabled };
}
