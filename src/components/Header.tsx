import HeaderClient from '@/src/components/HeaderClient'

// Always the signed-out markup, so public pages stay cacheable. The browser hides the Subscribe buttons in the
// subscriber view (see src/features/subscriber/subscriber-view.ts).
export default function Header() {
  return <HeaderClient />
}
