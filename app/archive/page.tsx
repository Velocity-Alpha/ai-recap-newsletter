import ArchiveView, { loadArchivePage } from './archive-view'

// Cached at the CDN for up to an hour; publishing an issue clears it through the published-issues tag.
export const revalidate = 3600

export default async function ArchivePage() {
    return <ArchiveView newsletterPage={await loadArchivePage(1)} />
}
