export interface NewsletterListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  issue_date?: string | null;
  published_at: string;
  feature_image_url?: string | null;
}
