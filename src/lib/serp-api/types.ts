export interface SerpAdResult {
  position: number;
  title: string;
  snippet: string;
  displayed_link: string;
  link: string;
  domain: string;
  sitelinks?: Array<{ title: string; link: string }>;
}

export interface SerpSearchResult {
  query: string;
  ads_top: SerpAdResult[];
  ads_bottom: SerpAdResult[];
  total_ads: number;
  search_metadata: {
    id: string;
    status: string;
    created_at: string;
  };
}
