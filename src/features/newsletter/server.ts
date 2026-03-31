import { parseNewsletterIssue } from "@/src/features/newsletter/parsers";
import type { NewsletterIssueApiResponse, ParsedNewsletterIssue } from "@/src/features/newsletter/types";

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

export async function fetchNewsletterIssueById(id: string): Promise<ParsedNewsletterIssue | null> {
  try {
    const apiUrl = getServerApiUrl("fetch-newsletter-by-id");
    const response = await fetch(`${apiUrl}?id=${id}`, {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const data = json?.data as NewsletterIssueApiResponse | undefined;

    if (!data) {
      return null;
    }

    return parseNewsletterIssue(data);
  } catch {
    return null;
  }
}

export async function fetchNewsletterIssueBySlug(slug: string): Promise<ParsedNewsletterIssue | null> {
  try {
    const apiUrl = getServerApiUrl("fetch-newsletter-by-slug");
    const response = await fetch(`${apiUrl}?slug=${encodeURIComponent(slug)}`, {
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const data = json?.data as NewsletterIssueApiResponse | undefined;

    if (!data) {
      return null;
    }

    return parseNewsletterIssue(data);
  } catch {
    return null;
  }
}
