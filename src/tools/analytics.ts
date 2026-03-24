import { z } from 'zod';
import { createGoogleAdsClient } from '../google-ads-client.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { conversionRateFromMetrics } from '../metrics-helpers.js';
import { customerIdOptional } from '../schema-common.js';

export const getTopBottomKeywordsSchema = z.object({
  metric: z.enum(['COST', 'CLICKS', 'CONVERSIONS', 'CTR', 'CONVERSION_RATE', 'CPC', 'QUALITY_SCORE']),
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH'
  ]).optional().default('LAST_30_DAYS'),
  topCount: z.number().optional().default(20),
  bottomCount: z.number().optional().default(20),
  campaignId: z.string().optional(),
  adGroupId: z.string().optional(),
  includeNegative: z.boolean().optional().default(false),
}).merge(customerIdOptional);

export const getKeywordOpportunitiesSchema = z.object({
  dateRange: z.enum([
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'LAST_90_DAYS'
  ]).optional().default('LAST_30_DAYS'),
  minImpressions: z.number().optional().default(100),
  maxCostPerConversion: z.number().optional(),
  minConversionRate: z.number().optional(),
}).merge(customerIdOptional);

export const getCampaignComparisonSchema = z.object({
  dateRange: z.enum([
    'TODAY', 
    'YESTERDAY', 
    'LAST_7_DAYS', 
    'LAST_30_DAYS', 
    'THIS_MONTH', 
    'LAST_MONTH'
  ]).optional().default('LAST_30_DAYS'),
  metric: z.enum(['COST', 'CLICKS', 'CONVERSIONS', 'ROAS', 'CPA']).optional().default('CONVERSIONS'),
  includeRemoved: z.boolean().optional().default(false),
}).merge(customerIdOptional);

function microsToNumber(micros: string | number | undefined): number | undefined {
  if (micros === undefined || micros === null) return undefined;
  return Number(micros) / 1_000_000;
}

export async function getTopBottomKeywords(args: z.infer<typeof getTopBottomKeywordsSchema>) {
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
      case 'CTR':
        orderByField = 'metrics.ctr';
        selectField = 'ctr';
        break;
      case 'CONVERSION_RATE':
        orderByField = 'metrics.conversions_from_interactions_rate';
        selectField = 'conversionRate';
        break;
      case 'CPC':
        orderByField = 'metrics.average_cpc';
        selectField = 'averageCpc';
        break;
      case 'QUALITY_SCORE':
        orderByField = 'ad_group_criterion.quality_info.quality_score';
        selectField = 'qualityScore';
        break;
    }
    
    let baseQuery = `
      SELECT 
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.status,
        ad_group_criterion.negative,
        ad_group_criterion.quality_info.quality_score,
        ad_group.name,
        campaign.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion
      FROM keyword_view
    `;
    
    const conditions = [];
    
    if (args.campaignId) {
      conditions.push(`campaign.id = ${args.campaignId}`);
    }
    
    if (args.adGroupId) {
      conditions.push(`ad_group.id = ${args.adGroupId}`);
    }
    
    if (!args.includeNegative) {
      conditions.push(`ad_group_criterion.negative = false`);
    }
    
    conditions.push(`ad_group_criterion.status != 'REMOVED'`);
    
    if (conditions.length > 0) {
      baseQuery += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    baseQuery += dateRangeClause;
    
    // Get top performers
    const topQuery = baseQuery + ` ORDER BY ${orderByField} DESC LIMIT ${args.topCount}`;
    const topResponse = await client.query(topQuery);
    
    // Get bottom performers (excluding zero values for most metrics)
    let bottomCondition = args.metric === 'QUALITY_SCORE' ? '' : ` AND ${orderByField} > 0`;
    const bottomQuery = baseQuery + bottomCondition + ` ORDER BY ${orderByField} ASC LIMIT ${args.bottomCount}`;
    const bottomResponse = await client.query(bottomQuery);
    
    const formatKeyword = (row: any) => ({
      keyword: row.ad_group_criterion?.keyword?.text,
      matchType: row.ad_group_criterion?.keyword?.match_type,
      status: row.ad_group_criterion?.status,
      isNegative: row.ad_group_criterion?.negative,
      qualityScore: row.ad_group_criterion?.quality_info?.quality_score,
      adGroupName: row.ad_group?.name,
      campaignName: row.campaign?.name,
      metrics: {
        clicks: row.metrics?.clicks || 0,
        impressions: row.metrics?.impressions || 0,
        cost: microsToNumber(row.metrics?.cost_micros) || 0,
        conversions: row.metrics?.conversions || 0,
        conversionsValue: microsToNumber(row.metrics?.conversions_value) || 0,
        ctr: row.metrics?.ctr || 0,
        averageCpc: microsToNumber(row.metrics?.average_cpc) || 0,
        conversionRate: conversionRateFromMetrics(row.metrics),
        costPerConversion: microsToNumber(row.metrics?.cost_per_conversion) || 0,
      }
    });
    
    return {
      metric: args.metric,
      dateRange: args.dateRange,
      topPerformers: topResponse.map(formatKeyword),
      bottomPerformers: bottomResponse.map(formatKeyword),
    };
  } catch (error) {
    throw new Error(`Failed to get top/bottom keywords: ${error.message}`);
  }
}

export async function getKeywordOpportunities(args: z.infer<typeof getKeywordOpportunitiesSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = ` DURING ${args.dateRange}`;
    
    // Find high-performing search terms that aren't keywords yet
    const searchTermsQuery = `
      SELECT 
        segments.search_term_match_type,
        search_term_view.search_term,
        campaign.name,
        ad_group.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion
      FROM search_term_view
      WHERE search_term_view.status = 'NONE'
        AND metrics.impressions >= ${args.minImpressions}
        ${args.maxCostPerConversion ? `AND metrics.cost_per_conversion <= ${args.maxCostPerConversion * 1_000_000}` : ''}
        ${args.minConversionRate ? `AND metrics.conversions_from_interactions_rate >= ${args.minConversionRate}` : ''}
      ${dateRangeClause}
      ORDER BY metrics.conversions DESC
      LIMIT 50
    `;
    
    const searchTermsResponse = await client.query(searchTermsQuery);
    
    // Find underperforming keywords that could be paused
    const underperformingQuery = `
      SELECT 
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        campaign.name,
        ad_group.name,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.ctr,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion
      FROM keyword_view
      WHERE ad_group_criterion.status = 'ENABLED'
        AND ad_group_criterion.negative = false
        AND metrics.impressions >= ${args.minImpressions}
        AND metrics.conversions = 0
        AND metrics.cost_micros > 0
      ${dateRangeClause}
      ORDER BY metrics.cost_micros DESC
      LIMIT 30
    `;
    
    const underperformingResponse = await client.query(underperformingQuery);
    
    return {
      dateRange: args.dateRange,
      newKeywordOpportunities: searchTermsResponse.map(row => ({
        searchTerm: row.search_term_view?.search_term,
        matchType: row.segments?.search_term_match_type,
        campaignName: row.campaign?.name,
        adGroupName: row.ad_group?.name,
        metrics: {
          clicks: row.metrics?.clicks || 0,
          impressions: row.metrics?.impressions || 0,
          cost: microsToNumber(row.metrics?.cost_micros) || 0,
          conversions: row.metrics?.conversions || 0,
          revenue: microsToNumber(row.metrics?.conversions_value) || 0,
          ctr: row.metrics?.ctr || 0,
          conversionRate: conversionRateFromMetrics(row.metrics),
          costPerConversion: microsToNumber(row.metrics?.cost_per_conversion) || 0,
        },
        recommendation: 'Add as keyword - high performance search term',
      })),
      underperformingKeywords: underperformingResponse.map(row => ({
        keyword: row.ad_group_criterion?.keyword?.text,
        matchType: row.ad_group_criterion?.keyword?.match_type,
        qualityScore: row.ad_group_criterion?.quality_info?.quality_score,
        campaignName: row.campaign?.name,
        adGroupName: row.ad_group?.name,
        metrics: {
          clicks: row.metrics?.clicks || 0,
          impressions: row.metrics?.impressions || 0,
          cost: microsToNumber(row.metrics?.cost_micros) || 0,
          ctr: row.metrics?.ctr || 0,
        },
        recommendation: 'Consider pausing - no conversions with significant spend',
      })),
    };
  } catch (error) {
    throw new Error(`Failed to get keyword opportunities: ${error.message}`);
  }
}

export async function getCampaignComparison(args: z.infer<typeof getCampaignComparisonSchema>) {
  const client = createGoogleAdsClient({ customerId: args.customerId });
  
  try {
    const dateRangeClause = ` DURING ${args.dateRange}`;
    
    const query = `
      SELECT 
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value,
        metrics.ctr,
        metrics.conversions_from_interactions_rate,
        metrics.cost_per_conversion,
        metrics.search_impression_share,
        metrics.search_rank_lost_impression_share,
        metrics.search_budget_lost_impression_share
      FROM campaign
      ${!args.includeRemoved ? "WHERE campaign.status != 'REMOVED'" : ''}
      ${dateRangeClause}
      ORDER BY metrics.${args.metric === 'ROAS' ? 'conversions_value' : args.metric === 'CPA' ? 'cost_per_conversion' : args.metric === 'COST' ? 'cost_micros' : args.metric === 'CLICKS' ? 'clicks' : args.metric === 'CONVERSIONS' ? 'conversions' : 'conversions_from_interactions_rate'} DESC
    `;
    
    const response = await client.query(query);
    
    const campaigns = response.map(row => {
      const cost = microsToNumber(row.metrics?.cost_micros) || 0;
      const revenue = microsToNumber(row.metrics?.conversions_value) || 0;
      const conversions = row.metrics?.conversions || 0;
      
      return {
        id: row.campaign?.id,
        name: row.campaign?.name,
        status: row.campaign?.status,
        type: row.campaign?.advertising_channel_type,
        biddingStrategy: row.campaign?.bidding_strategy_type,
        dailyBudget: microsToNumber(row.campaign_budget?.amount_micros) || 0,
        metrics: {
          clicks: row.metrics?.clicks || 0,
          impressions: row.metrics?.impressions || 0,
          cost,
          conversions,
          revenue,
          ctr: row.metrics?.ctr || 0,
          conversionRate: conversionRateFromMetrics(row.metrics),
          cpa: conversions > 0 ? cost / conversions : 0,
          roas: cost > 0 ? revenue / cost : 0,
          searchImpressionShare: row.metrics?.search_impression_share || 0,
          searchRankLostImpressionShare: row.metrics?.search_rank_lost_impression_share || 0,
          searchBudgetLostImpressionShare: row.metrics?.search_budget_lost_impression_share || 0,
        }
      };
    });
    
    // Calculate totals
    const totals = campaigns.reduce((acc, campaign) => ({
      clicks: acc.clicks + campaign.metrics.clicks,
      impressions: acc.impressions + campaign.metrics.impressions,
      cost: acc.cost + campaign.metrics.cost,
      conversions: acc.conversions + campaign.metrics.conversions,
      revenue: acc.revenue + campaign.metrics.revenue,
    }), {
      clicks: 0,
      impressions: 0,
      cost: 0,
      conversions: 0,
      revenue: 0,
    });
    
    totals['ctr'] = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals['conversionRate'] = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;
    totals['cpa'] = totals.conversions > 0 ? totals.cost / totals.conversions : 0;
    totals['roas'] = totals.cost > 0 ? totals.revenue / totals.cost : 0;
    
    return {
      dateRange: args.dateRange,
      sortedBy: args.metric,
      totals,
      campaigns,
    };
  } catch (error) {
    throw new Error(`Failed to get campaign comparison: ${error.message}`);
  }
}

export const analyticsTools: Tool[] = [
  {
    name: 'get_top_bottom_keywords',
    description: 'Get top and bottom performing keywords by various metrics',
    inputSchema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['COST', 'CLICKS', 'CONVERSIONS', 'CTR', 'CONVERSION_RATE', 'CPC', 'QUALITY_SCORE'],
          description: 'Metric to rank keywords by',
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
        adGroupId: {
          type: 'string',
          description: 'Filter by specific ad group ID (optional)',
        },
        includeNegative: {
          type: 'boolean',
          description: 'Include negative keywords in analysis',
        },
      },
      required: ['metric'],
    },
  },
  {
    name: 'get_keyword_opportunities',
    description: 'Find keyword opportunities based on search terms and underperforming keywords',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: {
          type: 'string',
          enum: ['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS'],
          description: 'Date range for analysis',
        },
        minImpressions: {
          type: 'number',
          description: 'Minimum impressions threshold',
        },
        maxCostPerConversion: {
          type: 'number',
          description: 'Maximum acceptable cost per conversion',
        },
        minConversionRate: {
          type: 'number',
          description: 'Minimum conversion rate percentage',
        },
      },
    },
  },
  {
    name: 'get_campaign_comparison',
    description: 'Compare all campaigns performance by various metrics',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: {
          type: 'string',
          enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'],
          description: 'Date range for comparison',
        },
        metric: {
          type: 'string',
          enum: ['COST', 'CLICKS', 'CONVERSIONS', 'ROAS', 'CPA'],
          description: 'Metric to sort campaigns by',
        },
        includeRemoved: {
          type: 'boolean',
          description: 'Include removed campaigns in comparison',
        },
      },
    },
  },
];