import type { MetadataRoute } from "next";

function getServerApiUrl(endpoint: string): string {
    const siteUrl = process.env.URL?.trim();
    if (siteUrl) {
        return `${siteUrl}/.netlify/functions/${endpoint}`;
    }
    const baseUrl = process.env.NEXT_PUBLIC_NEWSLETTER_URL?.trim();
    if (baseUrl) {
        return `${baseUrl.replace(/\/+$/, "")}/${endpoint}`;
    }
    return `http://localhost:8888/.netlify/functions/${endpoint}`;
}

interface NewsletterEntry {
    id: string;
    slug?: string | null;
    published_at: string;
    issue_date?: string;
}

interface NewsletterListResponse {
    success: boolean;
    data: NewsletterEntry[];
    pagination: {
        currentPage: number;
        totalPages: number;
        hasNextPage: boolean;
    };
}

async function fetchAllNewsletters(): Promise<NewsletterEntry[]> {
    const collected: NewsletterEntry[] = [];
    const apiUrl = getServerApiUrl("fetch-newsletters-list");
    let page = 1;

    while (true) {
        let json: NewsletterListResponse;
        try {
            const res = await fetch(`${apiUrl}?page=${page}&limit=100`, {
                next: { revalidate: 3600 },
            });
            if (!res.ok) break;
            json = await res.json();
            if (!json.success) break;
        } catch {
            break;
        }

        collected.push(...json.data);

        if (!json.pagination.hasNextPage) break;
        page++;
    }

    return collected;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const siteUrl =
        process.env.URL?.trim() ?? "http://localhost:8888";

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
