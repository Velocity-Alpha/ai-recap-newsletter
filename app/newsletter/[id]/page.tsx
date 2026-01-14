'use client'
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
    <section className="space-y-6">
        <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <h2 className="text-xl font-bold text-black uppercase tracking-wide">
                {title}
            </h2>
        </div>
        <div className="space-y-4">{children}</div>
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
                const apiUrl = getApiUrl('getDataById');
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
            <main className="flex-1 relative overflow-hidden bg-white">
                <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
                    {/* HEADER SECTION */}
                    <div className="text-center space-y-6">
                        <div className="inline-block px-4 py-1.5 rounded-full bg-[#66ccff]/10 text-[#66ccff] text-sm font-semibold border border-[#66ccff]/20">
                            AI Recap Newsletter
                        </div>
                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-black">
                            {title}
                        </h1>
                        {data.published_at && (
                            <p className="text-lg text-gray-600">
                                {formatDate(data.published_at)}
                            </p>
                        )}
                    </div>

                    {/* HERO IMAGE */}
                    {imageUrl && (
                        <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-xl">
                            <img src={imageUrl} alt={title} className="w-full h-[400px] md:h-[500px] object-cover" />
                        </div>
                    )}

                    {/* EXCERPT/DESCRIPTION (shown when content_json is null) */}
                    {!content_json && excerpt && (
                        <section className="space-y-6 bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-8 shadow-md">
                            <div className="flex items-center gap-3">
                                <span className="text-3xl">📋</span>
                                <h2 className="text-2xl font-bold text-black">
                                    Overview
                                </h2>
                            </div>
                            <p className="text-gray-700 text-lg leading-relaxed">
                                {excerpt}
                            </p>
                        </section>
                    )}

                    {/* OVERVIEW (if content_json exists) */}
                    {overview && (
                        <section className="space-y-6 bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-8 shadow-md">
                            <div className="flex items-center gap-3">
                                <span className="text-3xl">📋</span>
                                <h2 className="text-2xl font-bold text-black">
                                    Today&apos;s Overview
                                </h2>
                            </div>

                            {overview.summary && (
                                <p className="text-gray-700 text-lg leading-relaxed">
                                    {overview.summary}
                                </p>
                            )}

                            {overview.highlights && overview.highlights.length > 0 && (
                                <div className="border-l-4 border-[#66ccff] pl-6 space-y-3 bg-white/70 rounded-r-lg p-5">
                                    <p className="text-[#66ccff] text-lg font-semibold uppercase tracking-wide">
                                        Key Highlights
                                    </p>
                                    <ul className="space-y-2 text-base text-gray-700">
                                        {overview.highlights.map((point: string, idx: number) => (
                                            <li key={idx} className="flex gap-3 items-start">
                                                <span className="text-[#66ccff] mt-1">•</span>
                                                <span>{point}</span>
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
                            <div className="space-y-6">
                                {topStories.map((story: Item, i: number) => (
                                    <div
                                        key={i}
                                        className="space-y-4 bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow"
                                    >
                                        <h3 className="font-bold text-xl text-black">
                                            {story.link ? (
                                                <a
                                                    href={story.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[#66ccff] hover:underline transition-colors"
                                                >
                                                    {story.title}
                                                </a>
                                            ) : (
                                                story.title
                                            )}
                                        </h3>
                                        <p className="text-base text-gray-700 leading-relaxed">
                                            {story.summary}
                                        </p>
                                        {story.link && (
                                            <a
                                                href={story.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 text-sm text-[#66ccff] hover:underline font-medium"
                                            >
                                                <span className="bg-[#66ccff]/20 px-4 py-2 rounded-full">
                                                    Read More →
                                                </span>
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* RESEARCH */}
                    {research.length > 0 && (
                        <Section title="Research & Analysis" icon="📊">
                            <div className="space-y-6">
                                {research.map((item: Item, i: number) => (
                                    <div
                                        key={i}
                                        className="space-y-4 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow"
                                    >
                                        <h3 className="font-bold text-xl text-black">
                                            {item.link ? (
                                                <a
                                                    href={item.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[#66ccff] hover:underline transition-colors"
                                                >
                                                    {item.title}
                                                </a>
                                            ) : (
                                                item.title
                                            )}
                                        </h3>
                                        <p className="text-base text-gray-700 leading-relaxed">
                                            {item.summary}
                                        </p>
                                        {item.link && (
                                            <a
                                                href={item.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 text-sm text-[#66ccff] hover:underline font-medium"
                                            >
                                                <span className="bg-[#66ccff]/20 px-4 py-2 rounded-full">
                                                    Read More →
                                                </span>
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* TOOLS */}
                    {tools.length > 0 && (
                        <Section title="Trending Tools" icon="🛠️">
                            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6 shadow-md">
                                {tools.map((tool: Item, i: number) => (
                                    <div key={i} className="space-y-4 mb-6 last:mb-0 pb-6 last:pb-0 border-b last:border-b-0 border-green-200">
                                        <h3 className="font-bold text-xl text-black">
                                            {tool.link ? (
                                                <a
                                                    href={tool.link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[#66ccff] hover:underline transition-colors"
                                                >
                                                    {tool.title}
                                                </a>
                                            ) : (
                                                tool.title
                                            )}
                                        </h3>
                                        <p className="text-base text-gray-700 leading-relaxed">
                                            {tool.summary}
                                        </p>
                                        {tool.link && (
                                            <a
                                                href={tool.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 text-sm"
                                            >
                                                <span className="bg-orange-500/20 text-orange-600 px-4 py-2 rounded-full font-medium">
                                                    🔥 Trending
                                                </span>
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* QUICK HITS */}
                    {quickHits.length > 0 && (
                        <Section title="Quick Hits" icon="⚡">
                            <div className="space-y-3 bg-gradient-to-br from-yellow-50 to-amber-50 border border-yellow-200 rounded-xl p-6 shadow-md">
                                {quickHits.map((hit: Item, i: number) => (
                                    <div key={i} className="flex gap-3 text-base items-start">
                                        <span className="text-amber-600 mt-1 text-lg">•</span>
                                        <p className="text-gray-700">
                                            <span className="font-semibold text-black">{hit.title}</span>
                                            {hit.summary && `: ${hit.summary}`}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}
                    
                    <SubscribeNewsletter />
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Page;

