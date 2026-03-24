#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

// Only import working tools
import { listCampaigns, createCampaign, updateCampaign, listCampaignsSchema, createCampaignSchema, updateCampaignSchema } from './tools/campaigns.js';
import { addKeywords, addNegativeKeywords, updateKeyword, addKeywordsSchema, addNegativeKeywordsSchema, updateKeywordSchema } from './tools/keywords.js';
import { getSearchTermsReport, getSearchTermsReportSchema } from './tools/performance.js';
import { listAdGroups, createAdGroup, updateAdGroup, getAdGroup, listAdGroupsSchema, createAdGroupSchema, updateAdGroupSchema, getAdGroupSchema } from './tools/ad-groups.js';
import { listAds, listAdsSchema } from './tools/ads.js';

const server = new Server(
  {
    name: 'google-ads-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const customerIdProp = {
  customerId: {
    type: 'string',
    description:
      'Google Ads customer (account) ID for this request. Omit to use GOOGLE_ADS_CUSTOMER_ID from the server environment.',
  },
} as const;

// Define only working tools
const workingTools = [
  {
    name: 'list_campaigns',
    description: 'List all Google Ads campaigns with their metrics',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        limit: { type: 'number', description: 'Maximum number of campaigns to return' },
        includeRemoved: { type: 'boolean', description: 'Include removed campaigns' },
      },
    },
  },
  {
    name: 'create_campaign',
    description: 'Create a new Google Ads campaign',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        name: { type: 'string', description: 'Campaign name' },
        budget: { type: 'number', description: 'Daily budget in account currency' },
        advertisingChannelType: { 
          type: 'string', 
          enum: ['SEARCH', 'DISPLAY', 'SHOPPING', 'VIDEO', 'MULTI_CHANNEL'],
          description: 'Campaign type' 
        },
        status: { type: 'string', enum: ['ENABLED', 'PAUSED'], description: 'Campaign status' },
      },
      required: ['name', 'budget', 'advertisingChannelType'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update an existing campaign',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        campaignId: { type: 'string', description: 'Campaign ID' },
        name: { type: 'string', description: 'New campaign name' },
        status: { type: 'string', enum: ['ENABLED', 'PAUSED', 'REMOVED'], description: 'New campaign status' },
        budget: { type: 'number', description: 'New daily budget' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'list_ad_groups',
    description: 'List ad groups with their performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        campaignId: { type: 'string', description: 'Filter by campaign ID (optional)' },
        limit: { type: 'number', description: 'Maximum number of ad groups to return' },
        includeRemoved: { type: 'boolean', description: 'Include removed ad groups' },
      },
    },
  },
  {
    name: 'get_ad_group',
    description: 'Get detailed information about a specific ad group',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        adGroupId: { type: 'string', description: 'Ad group ID' },
      },
      required: ['adGroupId'],
    },
  },
  {
    name: 'create_ad_group',
    description: 'Create a new ad group in a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        campaignId: { type: 'string', description: 'Campaign ID' },
        name: { type: 'string', description: 'Ad group name' },
        status: { type: 'string', enum: ['ENABLED', 'PAUSED'], description: 'Initial status' },
        cpcBidMicros: { type: 'number', description: 'CPC bid in micros' },
      },
      required: ['campaignId', 'name'],
    },
  },
  {
    name: 'update_ad_group',
    description: 'Update an existing ad group',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        adGroupId: { type: 'string', description: 'Ad group ID' },
        name: { type: 'string', description: 'New name' },
        status: { type: 'string', enum: ['ENABLED', 'PAUSED', 'REMOVED'], description: 'New status' },
        cpcBidMicros: { type: 'number', description: 'New CPC bid in micros' },
      },
      required: ['adGroupId'],
    },
  },
  {
    name: 'list_ads',
    description: 'List ads with their performance data',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        adGroupId: { type: 'string', description: 'Filter by ad group ID' },
        campaignId: { type: 'string', description: 'Filter by campaign ID' },
        limit: { type: 'number', description: 'Maximum number of ads to return' },
        includeRemoved: { type: 'boolean', description: 'Include removed ads' },
      },
    },
  },
  {
    name: 'add_keywords',
    description: 'Add new keywords to an ad group',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        adGroupId: { type: 'string', description: 'Ad group ID' },
        keywords: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Keyword text' },
              matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], description: 'Match type' },
              cpcBidMicros: { type: 'number', description: 'CPC bid in micros' },
            },
            required: ['text', 'matchType'],
          },
        },
      },
      required: ['adGroupId', 'keywords'],
    },
  },
  {
    name: 'add_negative_keywords',
    description: 'Add negative keywords to a campaign or ad group',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        campaignId: { type: 'string', description: 'Campaign ID for campaign-level negatives' },
        adGroupId: { type: 'string', description: 'Ad group ID for ad group-level negatives' },
        keywords: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Keyword text' },
              matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], description: 'Match type' },
            },
            required: ['text', 'matchType'],
          },
        },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'update_keyword',
    description: 'Update keyword status or bid',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        keywordId: { type: 'string', description: 'Keyword ID' },
        adGroupId: { type: 'string', description: 'Ad group ID' },
        status: { type: 'string', enum: ['ENABLED', 'PAUSED', 'REMOVED'], description: 'New status' },
        cpcBidMicros: { type: 'number', description: 'New CPC bid in micros' },
      },
      required: ['keywordId', 'adGroupId'],
    },
  },
  {
    name: 'get_search_terms_report',
    description: 'Get search terms report to find new keyword opportunities',
    inputSchema: {
      type: 'object',
      properties: {
        ...customerIdProp,
        campaignId: { type: 'string', description: 'Filter by campaign ID' },
        adGroupId: { type: 'string', description: 'Filter by ad group ID' },
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
        limit: { type: 'number', description: 'Maximum number of search terms' },
        minImpressions: { type: 'number', description: 'Minimum impressions threshold' },
      },
    },
  },
];

const allTools = workingTools;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Working Campaign tools
      case 'list_campaigns':
        const listCampaignsArgs = listCampaignsSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await listCampaigns(listCampaignsArgs), null, 2) }] };
      
      case 'create_campaign':
        const createCampaignArgs = createCampaignSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await createCampaign(createCampaignArgs), null, 2) }] };
      
      case 'update_campaign':
        const updateCampaignArgs = updateCampaignSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await updateCampaign(updateCampaignArgs), null, 2) }] };

      // Working Keyword tools
      case 'add_keywords':
        const addKeywordsArgs = addKeywordsSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await addKeywords(addKeywordsArgs), null, 2) }] };
      
      case 'add_negative_keywords':
        const addNegativeKeywordsArgs = addNegativeKeywordsSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await addNegativeKeywords(addNegativeKeywordsArgs), null, 2) }] };
      
      case 'update_keyword':
        const updateKeywordArgs = updateKeywordSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await updateKeyword(updateKeywordArgs), null, 2) }] };

      // Performance tools
      case 'get_search_terms_report':
        const getSearchTermsReportArgs = getSearchTermsReportSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await getSearchTermsReport(getSearchTermsReportArgs), null, 2) }] };


      // Ad Group tools
      case 'list_ad_groups':
        const listAdGroupsArgs = listAdGroupsSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await listAdGroups(listAdGroupsArgs), null, 2) }] };
      
      case 'create_ad_group':
        const createAdGroupArgs = createAdGroupSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await createAdGroup(createAdGroupArgs), null, 2) }] };
      
      case 'update_ad_group':
        const updateAdGroupArgs = updateAdGroupSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await updateAdGroup(updateAdGroupArgs), null, 2) }] };
      
      case 'get_ad_group':
        const getAdGroupArgs = getAdGroupSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await getAdGroup(getAdGroupArgs), null, 2) }] };

      // Ad tools
      case 'list_ads':
        const listAdsArgs = listAdsSchema.parse(args);
        return { content: [{ type: 'text', text: JSON.stringify(await listAds(listAdsArgs), null, 2) }] };




      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${errorMessage}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Don't log anything to avoid breaking JSON output
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});