import { z } from 'zod';
import { createGoogleAdsClient, resolveCustomerId } from '../google-ads-client.js';
import { customerIdOptional } from '../schema-common.js';

const keywordPlanNetworkEnum = z.enum(['GOOGLE_SEARCH', 'GOOGLE_SEARCH_AND_PARTNERS']);

/** Recursively turn protobuf / Long-like values into JSON-safe data. */
export function toSerializable(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toSerializable);
  }
  if (t !== 'object') {
    return String(value);
  }
  const obj = value as Record<string, unknown> & { toObject?: (opts?: object) => object };
  if (typeof obj.toObject === 'function') {
    return toSerializable(obj.toObject({ defaults: false }));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) {
      continue;
    }
    out[k] = toSerializable(v);
  }
  return out;
}

export const generateKeywordIdeasSchema = z
  .object({
    seedType: z.enum(['keyword', 'url', 'site', 'keyword_and_url']),
    keywords: z.array(z.string()).optional(),
    url: z.string().optional(),
    site: z.string().optional(),
    geoTargetConstants: z.array(z.string()).max(10).optional(),
    language: z
      .string()
      .optional()
      .describe('Language resource name, e.g. languageConstants/1000 (English)'),
    keywordPlanNetwork: keywordPlanNetworkEnum.optional(),
    includeAdultKeywords: z.boolean().optional(),
    pageSize: z.number().int().positive().optional(),
    pageToken: z.string().optional(),
    historicalMetricsOptions: z.record(z.unknown()).optional(),
  })
  .merge(customerIdOptional)
  .superRefine((data, ctx) => {
    if (data.seedType === 'keyword') {
      const n = data.keywords?.length ?? 0;
      if (n < 1 || n > 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For seedType "keyword", provide keywords array with 1–20 items.',
          path: ['keywords'],
        });
      }
    }
    if (data.seedType === 'url' && !data.url?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'For seedType "url", provide url.',
        path: ['url'],
      });
    }
    if (data.seedType === 'site' && !data.site?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'For seedType "site", provide site.',
        path: ['site'],
      });
    }
    if (data.seedType === 'keyword_and_url') {
      const n = data.keywords?.length ?? 0;
      if (n < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For seedType "keyword_and_url", provide at least one keyword.',
          path: ['keywords'],
        });
      }
      if (!data.url?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For seedType "keyword_and_url", provide url.',
          path: ['url'],
        });
      }
    }
  });

export const generateKeywordHistoricalMetricsSchema = z
  .object({
    keywords: z.array(z.string()).min(1).max(10_000),
    geoTargetConstants: z.array(z.string()).max(10).optional(),
    language: z.string().optional(),
    keywordPlanNetwork: keywordPlanNetworkEnum.optional(),
    includeAdultKeywords: z.boolean().optional(),
    historicalMetricsOptions: z.record(z.unknown()).optional(),
    aggregateMetrics: z.record(z.unknown()).optional(),
  })
  .merge(customerIdOptional);

export const generateForecastMetricsSchema = z
  .object({
    /** `CampaignToForecast` message (snake_case fields), per Google Ads API v20. */
    campaign: z.record(z.unknown()),
    currencyCode: z.string().optional(),
    forecastPeriod: z
      .object({
        startDate: z.string(),
        endDate: z.string(),
      })
      .optional()
      .describe('YYYY-MM-DD; start must be in the future, end within one year'),
  })
  .merge(customerIdOptional);

export async function generateKeywordIdeas(params: z.infer<typeof generateKeywordIdeasSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  const customer_id = resolveCustomerId(params.customerId);

  const req: Record<string, unknown> = { customer_id };
  if (params.geoTargetConstants?.length) {
    req.geo_target_constants = params.geoTargetConstants;
  }
  if (params.language) {
    req.language = params.language;
  }
  if (params.keywordPlanNetwork) {
    req.keyword_plan_network = params.keywordPlanNetwork;
  }
  if (params.includeAdultKeywords !== undefined) {
    req.include_adult_keywords = params.includeAdultKeywords;
  }
  if (params.pageSize != null) {
    req.page_size = params.pageSize;
  }
  if (params.pageToken) {
    req.page_token = params.pageToken;
  }
  if (params.historicalMetricsOptions) {
    req.historical_metrics_options = params.historicalMetricsOptions;
  }

  switch (params.seedType) {
    case 'keyword':
      req.keyword_seed = { keywords: params.keywords! };
      break;
    case 'url':
      req.url_seed = { url: params.url! };
      break;
    case 'site':
      req.site_seed = { site: params.site! };
      break;
    case 'keyword_and_url':
      req.keyword_and_url_seed = { keywords: params.keywords!, url: params.url! };
      break;
  }

  const response = await customer.keywordPlanIdeas.generateKeywordIdeas(req as never);
  return toSerializable(response);
}

export async function generateKeywordHistoricalMetrics(
  params: z.infer<typeof generateKeywordHistoricalMetricsSchema>
) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  const customer_id = resolveCustomerId(params.customerId);

  const req: Record<string, unknown> = {
    customer_id,
    keywords: params.keywords,
  };
  if (params.geoTargetConstants?.length) {
    req.geo_target_constants = params.geoTargetConstants;
  }
  if (params.language) {
    req.language = params.language;
  }
  if (params.keywordPlanNetwork) {
    req.keyword_plan_network = params.keywordPlanNetwork;
  }
  if (params.includeAdultKeywords !== undefined) {
    req.include_adult_keywords = params.includeAdultKeywords;
  }
  if (params.historicalMetricsOptions) {
    req.historical_metrics_options = params.historicalMetricsOptions;
  }
  if (params.aggregateMetrics) {
    req.aggregate_metrics = params.aggregateMetrics;
  }

  const response = await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics(req as never);
  return toSerializable(response);
}

export async function generateForecastMetrics(params: z.infer<typeof generateForecastMetricsSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  const customer_id = resolveCustomerId(params.customerId);

  const req: Record<string, unknown> = {
    customer_id,
    campaign: params.campaign,
  };
  if (params.currencyCode) {
    req.currency_code = params.currencyCode;
  }
  if (params.forecastPeriod) {
    req.forecast_period = {
      start_date: params.forecastPeriod.startDate,
      end_date: params.forecastPeriod.endDate,
    };
  }

  const response = await customer.keywordPlanIdeas.generateKeywordForecastMetrics(req as never);
  return toSerializable(response);
}
