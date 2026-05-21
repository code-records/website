export type ReadonlyClient = {
    readFileReadonly(path: string): Promise<string | null>;
    readTreeReadonly(path?: string, recursive?: boolean): Promise<string[] | null>;
};