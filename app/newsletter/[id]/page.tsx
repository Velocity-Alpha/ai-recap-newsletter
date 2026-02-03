'use client'

import {  ArrowRight } from "lucide-react";

import Header from "@/src/components/Header";
import Footer from "@/src/components/Footer";
import SubscribeNewsletter from "@/src/components/SubscribeNewsletter";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { getApiUrl } from "@/src/utils/apiConfig";
import { formatDate } from "@/src/utils/dateFormatter";

interface Item {
    title: string;
    summary: string;
    link?: string;
}

interface ApiResponse {
    title: string;
    excerpt: string;
    published_at?: string;
    content_json: {
        imageUrl?: string;
        overview: {
            summary: string;
            highlights: string[];
        };
        topStories: Item[];
        research: Item[];
        tools: Item[];
        quickHits: Item[];
    };
}


const Section = ({
    title,
    icon,
    children,
}: {
    title: string;
    icon: string;
    children: React.ReactNode;
}) => (
    <section className="space-y-8">
        <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--watercolor-blue)] rounded-full"></div>
            <div className="flex items-center gap-4 pl-6 py-3">
                <span className="text-2xl">{icon}</span>
                <h2 className="font-serif font-normal text-[var(--text-primary)]" style={{ fontSize: '24px' }}>
                    {title}
                </h2>
            </div>
        </div>
        <div className="space-y-6">{children}</div>
    </section>
);

const Page = () => {
    const params = useParams();
    const id = params.id as string;
    const [data, setData] = useState<ApiResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const apiUrl = getApiUrl('fetch-newsletter-by-id');
                const res = await fetch(`${apiUrl}?id=${id}`, {
                  headers: {
                    'Content-Type': 'application/json',
                  },
                });
                const json = await res.json();
                setData(json?.data || null);
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };

        if (id) {
            fetchData();
        }
    }, [id]);

    if (loading) {
        return (
            <div className="flex flex-col min-h-screen bg-white">
                <Header />
                <main className="flex-1 flex items-center justify-center">
                    <p className="text-lg text-gray-600">Loading...</p>
                </main>
                <Footer />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex flex-col min-h-screen bg-white">
                <Header />
                <main className="flex-1 flex items-center justify-center">
                    <p className="text-lg text-gray-600">Newsletter not found</p>
                </main>
                <Footer />
            </div>
        );
    }

    const { title, excerpt, published_at, content_json } = data;
    
    // Extract content_json fields if available, otherwise use empty defaults
    const imageUrl = content_json?.imageUrl;
    const overview = content_json?.overview;
    const topStories = content_json?.topStories || [];
    const research = content_json?.research || [];
    const tools = content_json?.tools || [];
    const quickHits = content_json?.quickHits || [];

    return (
        <div className="flex flex-col min-h-screen bg-white">
            <Header />
            <main className="flex-1 relative overflow-hidden">
                <div className="relative z-10 max-w-4xl mx-auto px-6 py-16 space-y-16">
                    {/* HEADER SECTION */}
                    <div className="text-center space-y-6">
                        <div className="inline-flex items-center gap-2 font-medium text-[var(--text-muted)] uppercase tracking-[0.1em]" style={{ fontSize: 'calc(var(--text-small) * 0.95)' }}>
                            {data.published_at ? formatDate(data.published_at) : 'AI Recap Daily'}
                        </div>
                        <h1 className="font-serif font-normal leading-[1.12] text-[var(--text-primary)] tracking-[-0.02em]" style={{ fontSize: 'calc(var(--text-hero) * 0.88)' }}>
                            {title}
                        </h1>
                    </div>

                    {/* HERO IMAGE */}
                    {imageUrl && (
                        <div className="relative -mx-6">
                            <div className="relative">
                                <img src={imageUrl} alt={title} className="w-full h-auto max-h-[500px] object-cover" />
                            </div>
                        </div>
                    )}

                    {/* OVERVIEW (if content_json exists) */}
                    {overview && (
                        <section 
                            className="space-y-6 bg-[var(--bg-card)] border border-[var(--border-light)] rounded-lg p-10 shadow-sm relative overflow-hidden"
                        >
                            <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-[var(--watercolor-blue)] to-[var(--watercolor-rust)] opacity-50"></div>
                            <div className="flex items-center gap-3">
                                <span className="text-3xl">📋</span>
                                <h2 className="font-serif text-[var(--text-primary)]" style={{ fontSize: '24px' }}>
                                    Today&apos;s Overview
                                </h2>
                            </div>

                            {overview.summary && (
                                <p className="leading-[1.7] text-[var(--text-secondary)] italic" style={{ fontSize: 'calc(var(--text-body) * 0.95)' }}>
                                    {overview.summary}
                                </p>
                            )}

                            {overview.highlights && overview.highlights.length > 0 && (
                                <div className="mt-8 space-y-4">
                                    <p className="text-[var(--accent-warm)] font-bold uppercase tracking-wider" style={{ fontSize: 'calc(var(--text-small) * 0.95)' }}>
                                        Key Highlights
                                    </p>
                                    <ul className="space-y-4">
                                        {overview.highlights.map((point: string, idx: number) => (
                                            <li key={idx} className="flex gap-4 items-start text-[var(--text-primary)]" style={{ fontSize: 'calc(var(--text-body) * 0.95)' }}>
                                                <span className="min-w-[20px] h-[20px] flex items-center justify-center bg-[var(--bg-warm)] rounded-full text-[10px] border border-[var(--border-light)] text-[var(--text-muted)] mt-0.5">
                                                    {idx + 1}
                                                </span>
                                                <span className="leading-[1.6]">{point}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </section>
                    )}

                    {/* TOP STORIES */}
                    {topStories.length > 0 && (
                        <Section title="Top Stories" icon="🔥">
                            <div className="grid gap-12">
                                {topStories.map((story: Item, i: number) => (
                                    <article key={i} className="group">
                                        <div className="space-y-4">
                                            <h3 className="font-serif font-normal leading-[1.3] text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'calc(var(--text-card-title) * 0.92)' }}>
                                                {story.link ? (
                                                        <a
                                                            href={story.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="hover:underline"
                                                        >
                                                            {story.title}
                                                        </a>
                                                    ) : (
                                                        story.title
                                                    )}
                                                </h3>
                                                <p className="leading-[1.7] text-[var(--text-secondary)]" style={{ fontSize: 'calc(var(--text-body) * 0.95)' }}>
                                                    {story.summary}
                                                </p>
                                                {story.link && (
                                                    <a
                                                        href={story.link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 text-[var(--accent-primary)] font-semibold hover:gap-2.5 transition-all duration-200" style={{ fontSize: 'var(--text-small)' }}
                                                    >
                                                        Read Full Article <ArrowRight size={14} />
                                                    </a>
                                                )}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* RESEARCH */}
                    {research.length > 0 && (
                        <Section title="Research & Analysis" icon="📊">
                            <div className="grid gap-12">
                                {research.map((item: Item, i: number) => (
                                    <article key={i} className="group">
                                        <div className="space-y-4">
                                            <h3 className="font-serif font-normal leading-[1.3] text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors" style={{ fontSize: 'calc(var(--text-card-title) * 0.92)' }}>
                                                {item.link ? (
                                                        <a
                                                            href={item.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="hover:underline"
                                                        >
                                                            {item.title}
                                                        </a>
                                                    ) : (
                                                        item.title
                                                    )}
                                                </h3>
                                                <p className="leading-[1.7] text-[var(--text-secondary)]" style={{ fontSize: 'calc(var(--text-body) * 0.95)' }}>
                                                    {item.summary}
                                                </p>
                                                {item.link && (
                                                    <a
                                                        href={item.link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 text-[var(--accent-primary)] font-semibold hover:gap-2.5 transition-all duration-200" style={{ fontSize: 'var(--text-small)' }}
                                                    >
                                                        View Paper <ArrowRight size={14} />
                                                    </a>
                                                )}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* TOOLS */}
                    {tools.length > 0 && (
                        <Section title="Trending Tools" icon="🛠️">
                            <div className="grid gap-8">
                                {tools.map((tool: Item, i: number) => (
                                    <article key={i} className="flex gap-6 p-6 bg-[var(--bg-warm)] rounded-lg border border-[var(--border-light)] group hover:bg-[var(--bg-card)] transition-colors duration-250">
                                        <div className="min-w-[48px] h-[48px] bg-[var(--bg-card)] rounded-lg flex items-center justify-center text-xl shadow-sm border border-[var(--border-light)]">
                                            ⚙️
                                        </div>
                                        <div className="space-y-2">
                                            <h3 className="font-serif font-normal text-[var(--text-primary)]" style={{ fontSize: 'calc(var(--text-card-title) * 0.92)' }}>
                                                {tool.link ? (
                                                    <a href={tool.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                                        {tool.title}
                                                    </a>
                                                ) : tool.title}
                                            </h3>
                                            <p className="leading-[1.6] text-[var(--text-secondary)]" style={{ fontSize: '14px' }}>
                                                {tool.summary}
                                            </p>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* QUICK HITS */}
                    {quickHits.length > 0 && (
                        <Section title="Quick Hits" icon="⚡">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {quickHits.map((hit: Item, i: number) => (
                                    <div key={i} className="flex gap-4 p-5 bg-[var(--bg-card)] border border-[var(--border-light)] rounded-lg">
                                        <div className="flex-shrink-0 w-2 h-2 rounded-full bg-[var(--watercolor-rust)] mt-2"></div>
                                        <div className="flex-1">
                                            <p className="text-[var(--text-primary)]" style={{ fontSize: 'calc(var(--text-body) * 0.95)' }}>
                                                <span className="font-semibold">{hit.title}</span>
                                                {hit.summary && <span className="text-[var(--text-secondary)]"> — {hit.summary}</span>}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}
                    
                </div>
                <SubscribeNewsletter />
            </main>
            <Footer />
        </div>
    );
};

export default Page;
