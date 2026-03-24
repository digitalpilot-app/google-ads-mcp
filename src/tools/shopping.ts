import { z } from 'zod';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { conversionRateFromMetrics } from '../metrics-helpers.js';
import { customerIdOptional } from '../schema-common.js';

export const getProductPerformanceSchema = z.object({
  campaignId: z.string().optional(),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH',
    'ALL_TIME'
  ]).optional().default('LAST_30_DAYS'),
  limit: z.number().optional().default(100),
  orderBy: z.enum(['COST', 'CLICKS', 'CONVERSIONS', 'REVENUE', 'ROAS']).optional().default('COST'),
  orderDirection: z.enum(['ASC', 'DESC']).optional().default('DESC'),
}).merge(customerIdOptional);

export const getProductPartitionPerformanceSchema = z.object({
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

export const getTopBottomProductsSchema = z.object({
  metric: z.enum(['COST', 'CLICKS', 'CONVERSIONS', 'REVENUE', 'ROAS', 'CTR', 'CONVERSION_RATE']),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH'
  ]).optional().default('LAST_30_DAYS'),
  topCount: z.number().optional().default(10),
  bottomCount: z.number().optional().default(10),
  campaignId: z.string().optional(),
}).merge(customerIdOptional);

function microsToNumber(micros: string | number | undefined): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  return Number(micros) / 1_000_000;
}

export async function getProductPerformance(args: z.infer<typeof getProductPerformanceSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = args.dateRange === 'ALL_TIME' 
      ? '' 
      : ` DURING ${args.dateRange}`;
    
    let query = `
      SELECT 
        shopping_performance_view.resource_name,
        segments.product_item_id,
        segments.product_title,
        segments.product_type_l1,
        segments.product_type_l2,
        segments.product_type_l3,
        segments.product_brand,
        segments.product_custom_attribute0,
        segments.product_custom_attribute1,
        campaign.id,
        campaign.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion,
        metrics.value_per_conversion
      FROM shopping_performance_view
    `;
    
    const conditions = [];
    
    if (args.campaignId) {
      conditions.push(`campaign.id = ${args.campaignId}`);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += dateRangeClause;
    
    // Add ordering
    let orderByField = 'metrics.cost_micros';
    switch (args.orderBy) {
      case 'CLICKS':
        orderByField = 'metrics.clicks';
        break;
      case 'CONVERSIONS':
        orderByField = 'metrics.conversions';
        break;
      case 'REVENUE':
        orderByField = 'metrics.conversions_value';
        break;
      case 'ROAS':
        orderByField = 'metrics.conversions_value / metrics.cost_micros';
        break;
    }
    
    query += ` ORDER BY ${orderByField} ${args.orderDirection} LIMIT ${args.limit}`;
    
    const response = await client.query(query);
    
    return response.map(row => ({
      productItemId: row.segments?.product_item_id,
      productTitle: row.segments?.product_title,
      productBrand: row.segments?.product_brand,
      productType: {
        level1: row.segments?.product_type_l1,
        level2: row.segments?.product_type_l2,
        level3: row.segments?.product_type_l3,
      },
      customAttributes: {
        attribute0: row.segments?.product_custom_attribute0,
        attribute1: row.segments?.product_custom_attribute1,
      },
      campaignId: row.campaign?.id,
      campaignName: row.campaign?.name,
      metrics: {
        clicks: row.metrics?.clicks || 0,
        impressions: row.metrics?.impressions || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        revenue: microsToNumber(row.metrics?.conversions_value) || 0,
        ctr: row.metrics?.ctr || 0,
        averageCpc: microsToNumber(row.metrics?.average_cpc) || 0,
        conversionRate: conversionRateFromMetrics(row.metrics),
        costPerConversion: microsToNumber(row.metrics?.cost_per_conversion) || 0,
        valuePerConversion: microsToNumber(row.metrics?.value_per_conversion) || 0,
        roas: row.metrics?.conversions_value && row.metrics?.cost_micros 
          ? (Number(row.metrics.conversions_value) / Number(row.metrics.cost_micros)) 
          : 0,
      }
    }));
  } catch (error) {
    throw new Error(`Failed to get product performance: ${error.message}`);
  }
}

export async function getProductPartitionPerformance(args: z.infer<typeof getProductPartitionPerformanceSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = args.dateRange === 'ALL_TIME' 
      ? '' 
      : ` DURING ${args.dateRange}`;
    
    const query = `
      SELECT 
        ad_group_criterion.resource_name,
        ad_group_criterion.criterion_id,
        ad_group_criterion.status,
        ad_group_criterion.listing_group.type,
        ad_group_criterion.listing_group.case_value.product_brand.value,
        ad_group_criterion.listing_group.case_value.product_item_id.value,
        ad_group_criterion.listing_group.case_value.product_type.value,
        ad_group_criterion.listing_group.case_value.product_type.level,
        ad_group_criterion.cpc_bid_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_from_interactions_rate
      FROM ad_group_criterion
      WHERE ad_group.id = ${args.adGroupId}
        AND ad_group_criterion.type = 'LISTING_GROUP'
      ${dateRangeClause}
      ORDER BY metrics.cost_micros DESC
    `;
    
    const response = await client.query(query);
    
    return response.map(row => ({
      criterionId: row.ad_group_criterion?.criterion_id,
      status: row.ad_group_criterion?.status,
      listingGroupType: row.ad_group_criterion?.listing_group?.type,
      productBrand: row.ad_group_criterion?.listing_group?.case_value?.product_brand?.value,
      productItemId: row.ad_group_criterion?.listing_group?.case_value?.product_item_id?.value,
      productType: row.ad_group_criterion?.listing_group?.case_value?.product_type?.value,
      productTypeLevel: row.ad_group_criterion?.listing_group?.case_value?.product_type?.level,
      cpcBidMicros: row.ad_group_criterion?.cpc_bid_micros,
      metrics: {
        clicks: row.metrics?.clicks || 0,
        impressions: row.metrics?.impressions || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        revenue: microsToNumber(row.metrics?.conversions_value) || 0,
        ctr: row.metrics?.ctr || 0,
        averageCpc: microsToNumber(row.metrics?.average_cpc) || 0,
        conversionRate: conversionRateFromMetrics(row.metrics),
        roas: row.metrics?.conversions_value && row.metrics?.cost_micros 
          ? (Number(row.metrics.conversions_value) / Number(row.metrics.cost_micros)) 
          : 0,
      }
    }));
  } catch (error) {
    throw new Error(`Failed to get product partition performance: ${error.message}`);
  }
}

export async function getTopBottomProducts(args: z.infer<typeof getTopBottomProductsSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = ` DURING ${args.dateRange}`;
    
    let orderByField = 'metrics.cost_micros';
    let selectField = 'cost';
    
    switch (args.metric) {
      case 'CLICKS':
        orderByField = 'metrics.clicks';
        selectField = 'clicks';
        break;
      case 'CONVERSIONS':
        orderByField = 'metrics.conversions';
        selectField = 'conversions';
        break;
      case 'REVENUE':
        orderByField = 'metrics.conversions_value';
        selectField = 'revenue';
        break;
      case 'ROAS':
        orderByField = 'metrics.conversions_value / NULLIF(metrics.cost_micros, 0)';
        selectField = 'roas';
        break;
      case 'CTR':
        orderByField = 'metrics.ctr';
        selectField = 'ctr';
        break;
      case 'CONVERSION_RATE':
        orderByField = 'metrics.conversions_from_interactions_rate';
        selectField = 'conversionRate';
        break;
    }
    
    let baseQuery = `
      SELECT 
        segments.product_item_id,
        segments.product_title,
        segments.product_brand,
        campaign.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.conversions_from_interactions_rate
      FROM shopping_performance_view
    `;
    
    if (args.campaignId) {
      baseQuery += ` WHERE campaign.id = ${args.campaignId}`;
    }
    
    baseQuery += dateRangeClause;
    
    // Get top performers
    const topQuery = baseQuery + ` ORDER BY ${orderByField} DESC LIMIT ${args.topCount}`;
    const topResponse = await client.query(topQuery);
    
    // Get bottom performers (excluding zero values)
    const bottomQuery = baseQuery + ` AND ${orderByField} > 0 ORDER BY ${orderByField} ASC LIMIT ${args.bottomCount}`;
    const bottomResponse = await client.query(bottomQuery);
    
    const formatProduct = (row: any) => ({
      productItemId: row.segments?.product_item_id,
      productTitle: row.segments?.product_title,
      productBrand: row.segments?.product_brand,
      campaignName: row.campaign?.name,
      metrics: {
        clicks: row.metrics?.clicks || 0,
        impressions: row.metrics?.impressions || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        revenue: microsToNumber(row.metrics?.conversions_value) || 0,
        ctr: row.metrics?.ctr || 0,
        conversionRate: conversionRateFromMetrics(row.metrics),
        roas: row.metrics?.conversions_value && row.metrics?.cost_micros 
          ? (Number(row.metrics.conversions_value) / Number(row.metrics.cost_micros)) 
          : 0,
      },
      [selectField]: row.metrics?.[args.metric.toLowerCase()] || 
        (args.metric === 'REVENUE' ? microsToNumber(row.metrics?.conversions_value) : 
         args.metric === 'COST' ? microsToNumber(row.metrics?.cost_micros) :
         args.metric === 'ROAS' && row.metrics?.conversions_value && row.metrics?.cost_micros 
           ? (Number(row.metrics.conversions_value) / Number(row.metrics.cost_micros)) 
           : 0)
    });
    
    return {
      metric: args.metric,
      dateRange: args.dateRange,
      topPerformers: topResponse.map(formatProduct),
      bottomPerformers: bottomResponse.map(formatProduct),
    };
  } catch (error) {
    throw new Error(`Failed to get top/bottom products: ${error.message}`);
  }
}

export const shoppingTools: Tool[] = [
  {
    name: 'get_product_performance',
    description: 'Get performance data for products in shopping campaigns',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: {
          type: 'string',
          description: 'Filter by specific campaign ID (optional)',
        },
        dateRange: {
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'ALL_TIME'],
          description: 'Date range for metrics',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of products to return',
        },
        orderBy: {
          type: 'string',
          enum: ['COST', 'CLICKS', 'CONVERSIONS', 'REVENUE', 'ROAS'],
          description: 'Metric to order by',
        },
        orderDirection: {
          type: 'string',
          enum: ['ASC', 'DESC'],
          description: 'Order direction',
        },
      },
    },
  },
  {
    name: 'get_product_partition_performance',
    description: 'Get performance data for product partitions in an ad group',
    inputSchema: {
      type: 'object',
      properties: {
        adGroupId: {
          type: 'string',
          description: 'Ad group ID containing the product partitions',
        },
        dateRange: {
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH', 'ALL_TIME'],
          description: 'Date range for metrics',
        },
      },
      required: ['adGroupId'],
    },
  },
  {
    name: 'get_top_bottom_products',
    description: 'Get top and bottom performing products by various metrics',
    inputSchema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['COST', 'CLICKS', 'CONVERSIONS', 'REVENUE', 'ROAS', 'CTR', 'CONVERSION_RATE'],
          description: 'Metric to rank products by',
        },
        dateRange: {
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
          description: 'Date range for analysis',
        },
        topCount: {
          type: 'number',
          description: 'Number of top performers to return',
        },
        bottomCount: {
          type: 'number',
          description: 'Number of bottom performers to return',
        },
        campaignId: {
          type: 'string',
          description: 'Filter by specific campaign ID (optional)',
        },
      },
      required: ['metric'],
    },
  },
];