import HeaderClient from '@/components/HeaderClient'
import { hasActiveSubscriberSession } from '@/features/subscriber/session'

type HeaderProps = {
  showSubscribeButton?: boolean
}

export default async function Header({ showSubscribeButton }: HeaderProps) {
  const resolvedShowSubscribeButton = showSubscribeButton ?? !(await hasActiveSubscriberSession())

  return <HeaderClient showSubscribeButton={resolvedShowSubscribeButton} />
}
