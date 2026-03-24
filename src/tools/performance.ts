import { z } from 'zod';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { conversionRateFromMetrics, microsToUnits } from '../metrics-helpers.js';
import { customerIdOptional } from '../schema-common.js';

export const getAccountPerformanceSchema = z.object({
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_14_DAYS',
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH',
    'THIS_QUARTER',
    'LAST_QUARTER',
    'THIS_YEAR',
    'LAST_YEAR',
    'ALL_TIME'
  ]).optional().default('LAST_30_DAYS'),
  customDateRange: z.object({
    startDate: z.string().describe('YYYY-MM-DD format'),
    endDate: z.string().describe('YYYY-MM-DD format'),
  }).optional(),
  segmentByDate: z.boolean().optional().default(false),
}).merge(customerIdOptional);

export const getCampaignPerformanceSchema = z.object({
  campaignId: z.string(),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_14_DAYS',
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH'
  ]).optional().default('LAST_30_DAYS'),
  segmentByDate: z.boolean().optional().default(false),
}).merge(customerIdOptional);

export const getAdGroupPerformanceSchema = z.object({
  adGroupId: z.string().optional(),
  campaignId: z.string().optional(),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH'
  ]).optional().default('LAST_30_DAYS'),
  limit: z.number().optional().default(50),
}).merge(customerIdOptional);

export const getSearchTermsReportSchema = z.object({
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS',
    'THIS_MONTH',
    'LAST_MONTH',
    'CUSTOM'
  ]).optional().default('LAST_7_DAYS'),
  customDateRange: z.object({
    startDate: z.string().describe('YYYY-MM-DD format'),
    endDate: z.string().describe('YYYY-MM-DD format'),
  }).optional(),
  limit: z.number().optional().default(100),
  minImpressions: z.number().optional().default(10),
}).merge(customerIdOptional);

export async function getAccountPerformance(params: z.infer<typeof getAccountPerformanceSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  const segmentClause = params.segmentByDate ? ', segments.date' : '';
  const groupByClause = params.segmentByDate ? 'GROUP BY segments.date' : '';
  const orderByClause = params.segmentByDate ? 'ORDER BY segments.date DESC' : '';
  
  const query = `
    SELECT
      customer.descriptive_name,
      customer.currency_code,
      customer.id
      ${segmentClause},
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM customer
    WHERE segments.date DURING ${params.dateRange}
    ${groupByClause}
    ${orderByClause}
  `;

  const results = await customer.query(query);
  
  if (params.segmentByDate) {
    return results.map((row: any) => ({
      date: row.segments.date,
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: row.metrics?.cost_micros != null ? microsToUnits(row.metrics.cost_micros) : 0,
        conversions: row.metrics?.conversions || 0,
        ctr: row.metrics?.ctr || 0,
        avgCpc: row.metrics?.average_cpc != null ? microsToUnits(row.metrics.average_cpc) : 0,
        conversionRate: conversionRateFromMetrics(row.metrics),
        costPerConversion: row.metrics?.cost_per_conversion != null
          ? microsToUnits(row.metrics.cost_per_conversion)
          : 0,
        impressionShare: row.metrics?.search_impression_share || 0,
        budgetLostImpressionShare: row.metrics?.search_budget_lost_impression_share || 0,
        rankLostImpressionShare: row.metrics?.search_rank_lost_impression_share || 0,
      }
    }));
  } else {
    const [summary] = results;
    return {
      accountName: summary.customer.descriptive_name,
      customerId: summary.customer.id,
      currencyCode: summary.customer.currency_code,
      dateRange: params.dateRange,
      metrics: {
        impressions: summary.metrics?.impressions || 0,
        clicks: summary.metrics?.clicks || 0,
        cost: summary.metrics?.cost_micros != null ? microsToUnits(summary.metrics.cost_micros) : 0,
        conversions: summary.metrics?.conversions || 0,
        ctr: summary.metrics?.ctr || 0,
        avgCpc: summary.metrics?.average_cpc != null ? microsToUnits(summary.metrics.average_cpc) : 0,
        conversionRate: conversionRateFromMetrics(summary.metrics),
        costPerConversion: summary.metrics?.cost_per_conversion != null
          ? microsToUnits(summary.metrics.cost_per_conversion)
          : 0,
        impressionShare: summary.metrics?.search_impression_share || 0,
        budgetLostImpressionShare: summary.metrics?.search_budget_lost_impression_share || 0,
        rankLostImpressionShare: summary.metrics?.search_rank_lost_impression_share || 0,
      }
    };
  }
}

export async function getCampaignPerformance(params: z.infer<typeof getCampaignPerformanceSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  const segmentClause = params.segmentByDate ? ', segments.date' : '';
  const groupByClause = params.segmentByDate ? 'GROUP BY campaign.id, segments.date' : '';
  const orderByClause = params.segmentByDate ? 'ORDER BY segments.date DESC' : '';
  
  const query = `
    SELECT
      campaign.id,
      campaign.name
      ${segmentClause},
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion,
      metrics.value_per_conversion,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share,
      metrics.invalid_clicks,
      metrics.invalid_click_rate
    FROM campaign
    WHERE campaign.id = ${params.campaignId}
      AND segments.date DURING ${params.dateRange}
    ${groupByClause}
    ${orderByClause}
  `;

  const results = await customer.query(query);
  
  if (params.segmentByDate) {
    return {
      campaignId: params.campaignId,
      campaignName: results[0]?.campaign.name,
      daily: results.map((row: any) => ({
        date: row.segments.date,
        metrics: {
          impressions: row.metrics?.impressions || 0,
          clicks: row.metrics?.clicks || 0,
          cost: row.metrics?.cost_micros != null ? microsToUnits(row.metrics.cost_micros) : 0,
          conversions: row.metrics?.conversions || 0,
          conversionsValue: row.metrics?.conversions_value || 0,
          ctr: row.metrics?.ctr || 0,
          avgCpc: row.metrics?.average_cpc != null ? microsToUnits(row.metrics.average_cpc) : 0,
          conversionRate: conversionRateFromMetrics(row.metrics),
          costPerConversion: row.metrics?.cost_per_conversion != null
            ? microsToUnits(row.metrics.cost_per_conversion)
            : 0,
          valuePerConversion: row.metrics?.value_per_conversion != null
            ? microsToUnits(row.metrics.value_per_conversion)
            : 0,
          impressionShare: row.metrics?.search_impression_share || 0,
          invalidClicks: row.metrics?.invalid_clicks || 0,
          invalidClickRate: row.metrics?.invalid_click_rate || 0,
        }
      }))
    };
  } else {
    const [summary] = results;
    return {
      campaignId: summary.campaign.id,
      campaignName: summary.campaign.name,
      dateRange: params.dateRange,
      metrics: {
        impressions: summary.metrics?.impressions || 0,
        clicks: summary.metrics?.clicks || 0,
        cost: summary.metrics?.cost_micros != null ? microsToUnits(summary.metrics.cost_micros) : 0,
        conversions: summary.metrics?.conversions || 0,
        conversionsValue: summary.metrics?.conversions_value || 0,
        ctr: summary.metrics?.ctr || 0,
        avgCpc: summary.metrics?.average_cpc != null ? microsToUnits(summary.metrics.average_cpc) : 0,
        conversionRate: conversionRateFromMetrics(summary.metrics),
        costPerConversion: summary.metrics?.cost_per_conversion != null
          ? microsToUnits(summary.metrics.cost_per_conversion)
          : 0,
        valuePerConversion: summary.metrics?.value_per_conversion != null
          ? microsToUnits(summary.metrics.value_per_conversion)
          : 0,
        impressionShare: summary.metrics?.search_impression_share || 0,
        budgetLostImpressionShare: summary.metrics?.search_budget_lost_impression_share || 0,
        rankLostImpressionShare: summary.metrics?.search_rank_lost_impression_share || 0,
        invalidClicks: summary.metrics?.invalid_clicks || 0,
        invalidClickRate: summary.metrics?.invalid_click_rate || 0,
      }
    };
  }
}

export async function getAdGroupPerformance(params: z.infer<typeof getAdGroupPerformanceSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  let whereClause = `WHERE segments.date DURING ${params.dateRange}`;
  
  if (params.adGroupId) {
    whereClause += ` AND ad_group.id = ${params.adGroupId}`;
  }
  
  if (params.campaignId) {
    whereClause += ` AND campaign.id = ${params.campaignId}`;
  }
  
  const query = `
    SELECT
      ad_group.id,
      ad_group.name,
      ad_group.status,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion
    FROM ad_group
    ${whereClause}
    ORDER BY metrics.impressions DESC
    LIMIT ${params.limit}
  `;

  const adGroups = await customer.query(query);
  
  return adGroups.map((adGroup: any) => ({
    id: adGroup.ad_group.id,
    name: adGroup.ad_group.name,
    status: adGroup.ad_group.status,
    campaign: {
      id: adGroup.campaign.id,
      name: adGroup.campaign.name,
    },
    metrics: {
      impressions: adGroup.metrics?.impressions || 0,
      clicks: adGroup.metrics?.clicks || 0,
      cost: adGroup.metrics?.cost_micros != null ? microsToUnits(adGroup.metrics.cost_micros) : 0,
      conversions: adGroup.metrics?.conversions || 0,
      ctr: adGroup.metrics?.ctr || 0,
      avgCpc: adGroup.metrics?.average_cpc != null ? microsToUnits(adGroup.metrics.average_cpc) : 0,
      conversionRate: conversionRateFromMetrics(adGroup.metrics),
      costPerConversion: adGroup.metrics?.cost_per_conversion != null
        ? microsToUnits(adGroup.metrics.cost_per_conversion)
        : 0,
    }
  }));
}

export async function getSearchTermsReport(params: z.infer<typeof getSearchTermsReportSchema>) {
  const customer = createGoogleAdsClient({ customerId: params.customerId });
  
  let dateClause = '';
  if (params.dateRange === 'CUSTOM' && params.customDateRange) {
    dateClause = `segments.date BETWEEN '${params.customDateRange.startDate}' AND '${params.customDateRange.endDate}'`;
  } else {
    dateClause = `segments.date DURING ${params.dateRange}`;
  }
  
  let whereClause = `WHERE ${dateClause}
    AND metrics.impressions >= ${params.minImpressions}`;
  
  if (params.campaignId) {
    whereClause += ` AND campaign.id = ${params.campaignId}`;
  }
  
  if (params.adGroupId) {
    whereClause += ` AND ad_group.id = ${params.adGroupId}`;
  }
  
  const query = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM search_term_view
    ${whereClause}
    ORDER BY metrics.impressions DESC
    LIMIT ${params.limit}
  `;

  const searchTerms = await customer.query(query);
  
  return searchTerms.map((term: any) => ({
    searchTerm: term.search_term_view.search_term,
    status: term.search_term_view.status,
    campaign: {
      id: term.campaign.id,
      name: term.campaign.name,
    },
    adGroup: {
      id: term.ad_group.id,
      name: term.ad_group.name,
    },
    metrics: {
      impressions: term.metrics?.impressions || 0,
      clicks: term.metrics?.clicks || 0,
      cost: term.metrics?.cost_micros != null ? microsToUnits(term.metrics.cost_micros) : 0,
      conversions: term.metrics?.conversions || 0,
      ctr: term.metrics?.ctr || 0,
      avgCpc: term.metrics?.average_cpc != null ? microsToUnits(term.metrics.average_cpc) : 0,
      conversionRate: conversionRateFromMetrics(term.metrics),
    }
  }));
}

export const performanceTools: Tool[] = [
  {
    name: 'get_account_performance',
    description: 'Get overall account performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: { 
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'THIS_QUARTER', 'LAST_QUARTER'],
          description: 'Date range for metrics' 
        },
        segmentByDate: { type: 'boolean', description: 'Segment results by date' },
      },
    },
  },
  {
    name: 'get_campaign_performance',
    description: 'Get detailed campaign performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Campaign ID' },
        dateRange: { 
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
          description: 'Date range for metrics' 
        },
        segmentByDate: { type: 'boolean', description: 'Segment results by date' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'get_ad_group_performance',
    description: 'Get ad group performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        adGroupId: { type: 'string', description: 'Ad group ID (optional)' },
        campaignId: { type: 'string', description: 'Filter by campaign ID (optional)' },
        dateRange: { 
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
          description: 'Date range for metrics' 
        },
        limit: { type: 'number', description: 'Maximum number of ad groups to return' },
      },
    },
  },
  {
    name: 'get_search_terms_report',
    description: 'Get search terms report to find new keyword opportunities',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Filter by campaign ID (optional)' },
        adGroupId: { type: 'string', description: 'Filter by ad group ID (optional)' },
        dateRange: { 
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'CUSTOM'],
          description: 'Date range for report' 
        },
        customDateRange: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
            endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
          },
          required: ['startDate', 'endDate'],
          description: 'Custom date range (required when dateRange is CUSTOM)'
        },
        limit: { type: 'number', description: 'Maximum number of search terms to return' },
        minImpressions: { type: 'number', description: 'Minimum impressions threshold' },
      },
    },
  },
];