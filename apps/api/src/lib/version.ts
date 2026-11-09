import packageJson from '../../package.json';

/** API version, from apps/api/package.json (inlined by `bun build`). */
export const API_VERSION: string = packageJson.version;
