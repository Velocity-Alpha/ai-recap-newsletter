import FooterClient from '@/components/FooterClient'
import { hasActiveSubscriberSession } from '@/features/subscriber/session'

type FooterProps = {
  showSubscribeLink?: boolean
}

export default async function Footer({ showSubscribeLink }: FooterProps) {
  const resolvedShowSubscribeLink = showSubscribeLink ?? !(await hasActiveSubscriberSession())

  return <FooterClient showSubscribeLink={resolvedShowSubscribeLink} />
}
