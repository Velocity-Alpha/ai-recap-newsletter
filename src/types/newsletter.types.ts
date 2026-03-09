export interface Newsletter {
  id: string;
  title: string;
  excerpt: string;
  issue_date?: string | null;
  published_at: string;
  feature_image_url: string;
}
