import { GoogleAdsApi } from 'google-ads-api';
import { googleAdsConfig } from './config.js';

export type CreateGoogleAdsClientOptions = {
  /** Google Ads customer id for this request (account being queried). Dashes allowed. */
  customerId?: string;
};

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/**
 * Resolves the customer id for an API call: explicit argument, then env default.
 * @throws If neither is set
 */
export function resolveCustomerId(explicit?: string | null): string {
  const fromArg = explicit ? digitsOnly(explicit) : '';
  const fromEnv = googleAdsConfig.customerId ? digitsOnly(googleAdsConfig.customerId) : '';
  const id = fromArg || fromEnv;
  if (!id) {
    throw new Error(
      'Google Ads customer id is required: pass customerId on the tool call or set GOOGLE_ADS_CUSTOMER_ID in the environment.'
    );
  }
  return id;
}

export function createGoogleAdsClient(options?: CreateGoogleAdsClientOptions) {
  const customerId = resolveCustomerId(options?.customerId);

  const client = new GoogleAdsApi({
    client_id: googleAdsConfig.clientId,
    client_secret: googleAdsConfig.clientSecret,
    developer_token: googleAdsConfig.developerToken,
  });

  const customer = client.Customer({
    customer_id: customerId,
    login_customer_id: googleAdsConfig.loginCustomerId,
    refresh_token: googleAdsConfig.refreshToken,
  });

  return customer;
}
