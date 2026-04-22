import { z } from 'zod';
import { resources } from 'google-ads-api';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { conversionRateFromMetrics } from '../metrics-helpers.js';
import { customerIdOptional } from '../schema-common.js';
import { throwGoogleAdsMutateError } from '../google-ads-error.js';

export const listAdsSchema = z.object({
  adGroupId: z.string().optional(),
  campaignId: z.string().optional(),
  limit: z.number().optional().default(100),
  includeRemoved: z.boolean().optional().default(false),
}).merge(customerIdOptional);

export const createResponsiveSearchAdSchema = z.object({
  adGroupId: z.string(),
  headlines: z.array(z.object({
    text: z.string().max(30),
    pinned_field: z.number().optional(),
  })).min(3).max(15),
  descriptions: z.array(z.object({
    text: z.string().max(90),
    pinned_field: z.number().optional(),
  })).min(2).max(4),
  path1: z.string().max(15).optional(),
  path2: z.string().max(15).optional(),
  finalUrls: z.array(z.string()).min(1),
  finalMobileUrls: z.array(z.string()).optional(),
  trackingUrlTemplate: z.string().optional(),
}).merge(customerIdOptional);

export const createAdSchema = createResponsiveSearchAdSchema.extend({
  adType: z.enum(['RESPONSIVE_SEARCH_AD']).optional().default('RESPONSIVE_SEARCH_AD'),
});

export const updateAdSchema = z.object({
  adId: z.string(),
  adGroupId: z.string(),
  status: z.enum(['ENABLED', 'PAUSED', 'REMOVED']).optional(),
}).merge(customerIdOptional);

export const getAdPerformanceSchema = z.object({
  adId: z.string(),
  adGroupId: z.string(),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH',
    'ALL_TIME'
  ]).optional().default('LAST_30_DAYS'),
}).merge(customerIdOptional);

function microsToNumber(micros: string | number | undefined): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  return Number(micros) / 1_000_000;
}

export async function listAds(args: z.infer<typeof listAdsSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    let query = `
      SELECT 
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.ad_group,
        ad_group.name,
        campaign.id,
        campaign.name,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.ad.final_urls,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.average_cpc
      FROM ad_group_ad
    `;
    
    const conditions = [];
    
    if (args.adGroupId) {
      conditions.push(`ad_group.id = ${args.adGroupId}`);
    }
    
    if (args.campaignId) {
      conditions.push(`campaign.id = ${args.campaignId}`);
    }
    
    if (!args.includeRemoved) {
      conditions.push(`ad_group_ad.status != 'REMOVED'`);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY ad_group_ad.ad.id DESC LIMIT ${args.limit}`;
    
    const response = await client.query(query);
    
    return response.map(row => ({
      id: row.ad_group_ad?.ad?.id,
      name: row.ad_group_ad?.ad?.name,
      type: row.ad_group_ad?.ad?.type,
      status: row.ad_group_ad?.status,
      adGroupId: row.ad_group_ad?.ad_group?.split('/').pop(),
      adGroupName: row.ad_group?.name,
      campaignId: row.campaign?.id,
      campaignName: row.campaign?.name,
      headlines: row.ad_group_ad?.ad?.responsive_search_ad?.headlines || [],
      descriptions: row.ad_group_ad?.ad?.responsive_search_ad?.descriptions || [],
      path1: row.ad_group_ad?.ad?.responsive_search_ad?.path1,
      path2: row.ad_group_ad?.ad?.responsive_search_ad?.path2,
      finalUrls: row.ad_group_ad?.ad?.final_urls || [],
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        ctr: row.metrics?.ctr || 0,
        averageCpc: microsToNumber(row.metrics?.average_cpc) || 0,
      }
    }));
  } catch (error) {
    throw new Error(`Failed to list ads: ${error.message}`);
  }
}

export async function createResponsiveSearchAd(args: z.infer<typeof createResponsiveSearchAdSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const cid = client.credentials.customer_id;
    const adGroupAd: resources.IAdGroupAd = {
      ad_group: `customers/${cid}/adGroups/${args.adGroupId}`,
      status: 'ENABLED',
      ad: {
        responsive_search_ad: {
          headlines: args.headlines.map(headline => ({
            text: headline.text,
            pinned_field: headline.pinned_field,
          })),
          descriptions: args.descriptions.map(description => ({
            text: description.text,
            pinned_field: description.pinned_field,
          })),
          path1: args.path1,
          path2: args.path2,
        },
        final_urls: args.finalUrls,
        final_mobile_urls: args.finalMobileUrls,
        tracking_url_template: args.trackingUrlTemplate,
      },
    };
    
    const response = await client.adGroupAds.create([adGroupAd]);
    
    const result = response.results?.[0];
    const adId = result?.resource_name?.split('~').pop();
    
    return {
      success: true,
      adId,
      resourceName: result?.resource_name,
    };
  } catch (error) {
    throwGoogleAdsMutateError(
      {
        operation: 'create_ad',
        action: 'Failed to create ad',
        customerId: client.credentials.customer_id,
        request: args,
      },
      error
    );
  }
}

export async function createAd(args: z.infer<typeof createAdSchema>) {
  // Current implementation supports responsive search ads only.
  return createResponsiveSearchAd(args);
}

export async function updateAd(args: z.infer<typeof updateAdSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const cid = client.credentials.customer_id;
    const resourceName = `customers/${cid}/adGroupAds/${args.adGroupId}~${args.adId}`;
    
    const response = await client.adGroupAds.update([
      {
        resource_name: resourceName,
        status: args.status,
      } as resources.IAdGroupAd,
    ]);
    
    return {
      success: true,
      resourceName: response.results?.[0]?.resource_name,
    };
  } catch (error) {
    throwGoogleAdsMutateError(
      {
        operation: 'update_ad',
        action: 'Failed to update ad',
        customerId: client.credentials.customer_id,
        request: args,
      },
      error
    );
  }
}

export async function getAdPerformance(args: z.infer<typeof getAdPerformanceSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = args.dateRange === 'ALL_TIME' 
      ? '' 
      : ` DURING ${args.dateRange}`;
    
    const query = `
      SELECT 
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion,
        metrics.value_per_conversion,
        metrics.all_conversions,
        metrics.all_conversions_value
      FROM ad_group_ad
      WHERE ad_group_ad.ad.id = ${args.adId}
        AND ad_group.id = ${args.adGroupId}
      ${dateRangeClause}
    `;
    
    const response = await client.query(query);
    
    if (response.length === 0) {
      throw new Error('Ad not found');
    }
    
    const row = response[0];
    
    return {
      id: row.ad_group_ad?.ad?.id,
      name: row.ad_group_ad?.ad?.name,
      type: row.ad_group_ad?.ad?.type,
      status: row.ad_group_ad?.status,
      dateRange: args.dateRange,
      metrics: {
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        conversionsValue: microsToNumber(row.metrics?.conversions_value) || 0,
        ctr: row.metrics?.ctr || 0,
        averageCpc: microsToNumber(row.metrics?.average_cpc) || 0,
        averageCpm: microsToNumber(row.metrics?.average_cpm) || 0,
        conversionRate: conversionRateFromMetrics(row.metrics),
        costPerConversion: microsToNumber(row.metrics?.cost_per_conversion) || 0,
        valuePerConversion: microsToNumber(row.metrics?.value_per_conversion) || 0,
        allConversions: row.metrics?.all_conversions || 0,
        allConversionsValue: microsToNumber(row.metrics?.all_conversions_value) || 0,
      }
    };
  } catch (error) {
    throw new Error(`Failed to get ad performance: ${error.message}`);
  }
}

export const adTools: Tool[] = [
  {
    name: 'list_ads',
    description: 'List ads with their performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        adGroupId: {
          type: 'string',
          description: 'Filter by ad group ID (optional)',
        },
        campaignId: {
          type: 'string',
          description: 'Filter by campaign ID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of ads to return',
        },
        includeRemoved: {
          type: 'boolean',
          description: 'Include removed ads',
        },
      },
    },
  },
  {
    name: 'create_ad',
    description: 'Create a new ad (currently supports responsive search ads)',
    inputSchema: {
      type: 'object',
      properties: {
        adType: {
          type: 'string',
          enum: ['RESPONSIVE_SEARCH_AD'],
          description: 'Ad type to create (default: RESPONSIVE_SEARCH_AD)',
        },
        adGroupId: {
          type: 'string',
          description: 'Ad group ID where the ad will be created',
        },
        headlines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Headline text (max 30 characters)',
              },
              pinned_field: {
                type: 'number',
                description: 'Position to pin this headline (1-3, optional)',
              },
            },
            required: ['text'],
          },
          description: 'Headlines for the ad (3-15 headlines)',
        },
        descriptions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Description text (max 90 characters)',
              },
              pinned_field: {
                type: 'number',
                description: 'Position to pin this description (1-2, optional)',
              },
            },
            required: ['text'],
          },
          description: 'Descriptions for the ad (2-4 descriptions)',
        },
        path1: {
          type: 'string',
          description: 'First path component (max 15 characters)',
        },
        path2: {
          type: 'string',
          description: 'Second path component (max 15 characters)',
        },
        finalUrls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Landing page URLs',
        },
        finalMobileUrls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Mobile landing page URLs (optional)',
        },
        trackingUrlTemplate: {
          type: 'string',
          description: 'Tracking URL template (optional)',
        },
      },
      required: ['adGroupId', 'headlines', 'descriptions', 'finalUrls'],
    },
  },
  {
    name: 'create_responsive_search_ad',
    description: 'Create a new responsive search ad',
    inputSchema: {
      type: 'object',
      properties: {
        adGroupId: {
          type: 'string',
          description: 'Ad group ID where the ad will be created',
        },
        headlines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Headline text (max 30 characters)',
              },
              pinned_field: {
                type: 'number',
                description: 'Position to pin this headline (1-3, optional)',
              },
            },
            required: ['text'],
          },
          description: 'Headlines for the ad (3-15 headlines)',
        },
        descriptions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Description text (max 90 characters)',
              },
              pinned_field: {
                type: 'number',
                description: 'Position to pin this description (1-2, optional)',
              },
            },
            required: ['text'],
          },
          description: 'Descriptions for the ad (2-4 descriptions)',
        },
        path1: {
          type: 'string',
          description: 'First path component (max 15 characters)',
        },
        path2: {
          type: 'string',
          description: 'Second path component (max 15 characters)',
        },
        finalUrls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Landing page URLs',
        },
        finalMobileUrls: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Mobile landing page URLs (optional)',
        },
        trackingUrlTemplate: {
          type: 'string',
          description: 'Tracking URL template (optional)',
        },
      },
      required: ['adGroupId', 'headlines', 'descriptions', 'finalUrls'],
    },
  },
  {
    name: 'update_ad',
    description: 'Update an existing ad status',
    inputSchema: {
      type: 'object',
      properties: {
        adId: {
          type: 'string',
          description: 'Ad ID to update',
        },
        adGroupId: {
          type: 'string',
          description: 'Ad group ID containing the ad',
        },
        status: {
          type: 'string',
          enum: ['ENABLED', 'PAUSED', 'REMOVED'],
          description: 'New status for the ad',
        },
      },
      required: ['adId', 'adGroupId'],
    },
  },
  {
    name: 'get_ad_performance',
    description: 'Get detailed performance metrics for a specific ad',
    inputSchema: {
      type: 'object',
      properties: {
        adId: {
          type: 'string',
          description: 'Ad ID',
        },
        adGroupId: {
          type: 'string',
          description: 'Ad group ID containing the ad',
        },
        dateRange: {
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'ALL_TIME'],
          description: 'Date range for metrics',
        },
      },
      required: ['adId', 'adGroupId'],
    },
  },
];