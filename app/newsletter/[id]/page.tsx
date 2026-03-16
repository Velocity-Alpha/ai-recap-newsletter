import type { Metadata } from "next";
import { getTrimmedImageUrl } from "@/src/lib/utils";
import NewsletterContent from "./NewsletterContent";

interface PageProps {
    params: Promise<{ id: string }>;
}

function getServerApiUrl(endpoint: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_NEWSLETTER_URL?.trim();
    if (baseUrl) {
        return `${baseUrl.replace(/\/+$/, "")}/${endpoint}`;
    }
    const siteUrl = process.env.URL?.trim();
    if (siteUrl) {
        return `${siteUrl}/.netlify/functions/${endpoint}`;
    }
    return `http://localhost:8888/.netlify/functions/${endpoint}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;

    try {
        const apiUrl = getServerApiUrl("fetch-newsletter-by-id");
        const res = await fetch(`${apiUrl}?id=${id}`, {
            next: { revalidate: 3600 },
        });

        if (!res.ok) return {};

        const json = await res.json();
        const data = json?.data;
        if (!data) return {};

        const { title, excerpt, feature_image_url, content_json, issue_date, published_at } = data;
        const imageUrl =
            getTrimmedImageUrl(feature_image_url) ??
            getTrimmedImageUrl(content_json?.imageUrl);
        const description = content_json?.overview?.summary ?? excerpt;

        return {
            title: `${title} | AI Recap`,
            description,
            alternates: {
                canonical: `/newsletter/${id}`,
            },
            openGraph: {
                type: "article",
                title,
                description,
                publishedTime: issue_date ?? published_at,
                ...(imageUrl && {
                    images: [{ url: imageUrl, alt: title }],
                }),
            },
            twitter: {
                card: "summary_large_image",
                title,
                description,
                ...(imageUrl && { images: [imageUrl] }),
            },
        };
    } catch {
        return {};
    }
}

export default async function Page({ params }: PageProps) {
    const { id } = await params;

    try {
        const apiUrl = getServerApiUrl("fetch-newsletter-by-id");
        const res = await fetch(`${apiUrl}?id=${id}`, {
            next: { revalidate: 3600 },
        });

        if (!res.ok) return <NewsletterContent />;

        const json = await res.json();
        const data = json?.data;
        if (!data) return <NewsletterContent />;

        const { title, excerpt, feature_image_url, content_json, issue_date, published_at } = data;
        const imageUrl =
            getTrimmedImageUrl(feature_image_url) ??
            getTrimmedImageUrl(content_json?.imageUrl);
        const description = content_json?.overview?.summary ?? excerpt;

        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            headline: title,
            description,
            ...(imageUrl && { image: imageUrl }),
            datePublished: issue_date ?? published_at,
            publisher: {
                "@type": "Organization",
                name: "AI Recap",
                logo: {
                    "@type": "ImageObject",
                    url: "https://airecap.news/logo/OG-Logo.jpg",
                },
            },
        };

        return (
            <>
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
                />
                <NewsletterContent />
            </>
        );
    } catch {
        return <NewsletterContent />;
    }
}
