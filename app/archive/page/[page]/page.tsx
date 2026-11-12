import { notFound, redirect } from 'next/navigation'

import ArchiveView, { loadArchivePage } from '../../archive-view'
import { ARCHIVE_PATH, parseArchivePageNumber } from '@/src/features/newsletter/archive-paths'

// Built on first visit, then cached at the CDN for up to an hour; publishing an issue clears it through the
// published-issues tag. No database read happens at build.
export const revalidate = 3600
export const dynamicParams = true

export function generateStaticParams() {
    return []
}

interface ArchivePageNProps {
    params: Promise<{ page: string }>
}

export default async function ArchivePageN({ params }: ArchivePageNProps) {
    const { page } = await params
    const pageNumber = parseArchivePageNumber(page)

    if (pageNumber === null) {
        notFound()
    }

    // One address for the first page.
    if (pageNumber === 1) {
        redirect(ARCHIVE_PATH)
    }

    return <ArchiveView newsletterPage={await loadArchivePage(pageNumber)} />
}
