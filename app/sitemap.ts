import type { MetadataRoute } from "next";
import { getSafeCachedPublishedNewsletterEntries } from "@/features/newsletter/server";

function getSiteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL?.trim()
        ?? process.env.URL?.trim()
        ?? "http://localhost:3000";
}

interface NewsletterEntry {
    id: string;
    slug?: string | null;
    published_at: string;
    issue_date?: string | null;
}

async function fetchAllNewsletters(): Promise<NewsletterEntry[]> {
    return getSafeCachedPublishedNewsletterEntries();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const siteUrl = getSiteUrl();

    const newsletters = await fetchAllNewsletters();

    const newsletterEntries: MetadataRoute.Sitemap = newsletters.map(
        (entry) => ({
            url: entry.slug
                ? `${siteUrl}/issue/${entry.slug}`
                : `${siteUrl}/newsletter/${entry.id}`,
            lastModified: entry.issue_date ?? entry.published_at,
            changeFrequency: "never",
        })
    );

    return [
        {
            url: siteUrl,
            changeFrequency: "daily",
            priority: 1,
        },
        ...newsletterEntries,
    ];
}
