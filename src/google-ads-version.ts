import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('google-ads-api/package.json') as { version: string };

/** Installed `google-ads-api` npm version (e.g. 23.0.0). */
export const GOOGLE_ADS_NODE_PACKAGE_VERSION = pkg.version;

/**
 * Google Ads API RPC version used by that package (major), e.g. v23 for google-ads-api 23.x.
 * @see https://developers.google.com/google-ads/api/docs/release-notes
 */
export const GOOGLE_ADS_API_VERSION = `v${pkg.version.split('.')[0]}` as const;
