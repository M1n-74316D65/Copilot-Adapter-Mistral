export type ModelOptions = Record<string, unknown>;

export function toModelOptions ( val: unknown ): ModelOptions {
    return ( val !== null && typeof val === `object` ) ? ( val as ModelOptions ) : {};
}

export function getNumberOption ( opts: ModelOptions, key: string ): number | undefined {
    const optionValue = opts[ key ];
    return typeof optionValue === `number` ? optionValue : undefined;
}

export function getBooleanOption ( opts: ModelOptions, key: string ): boolean | undefined {
    const optionValue = opts[ key ];
    return typeof optionValue === `boolean` ? optionValue : undefined;
}

export function getStringOption ( opts: ModelOptions, key: string ): string | undefined {
    const optionValue = opts[ key ];
    return typeof optionValue === `string` && optionValue.length > 0 ? optionValue : undefined;
}
