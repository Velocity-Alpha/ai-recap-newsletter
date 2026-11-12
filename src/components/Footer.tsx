import FooterClient from '@/src/components/FooterClient'

// Always the signed-out markup, so public pages stay cacheable. The browser hides the Subscribe link in the
// subscriber view (see src/features/subscriber/subscriber-view.ts).
export default function Footer() {
  return <FooterClient />
}
