export function shallowEqual(a: any, b: any): boolean {
    if (Object.is(a, b)) return true;

    if (
        typeof a !== "object" ||
        a === null ||
        typeof b !== "object" ||
        b === null
    ) {
        return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;

    for (const k of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!Object.is(a[k], b[k])) return false;
    }

    return true;
}

export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false;
    }
    return true;
}