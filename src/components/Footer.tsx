import FooterClient from '@/src/components/FooterClient'
import { hasActiveSubscriberSession } from '@/src/features/subscriber/server'

type FooterProps = {
  showSubscribeLink?: boolean
}

export default async function Footer({ showSubscribeLink }: FooterProps) {
  const resolvedShowSubscribeLink = showSubscribeLink ?? !(await hasActiveSubscriberSession())

  return <FooterClient showSubscribeLink={resolvedShowSubscribeLink} />
}
