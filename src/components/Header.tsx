import HeaderClient from '@/src/components/HeaderClient'
import { hasActiveSubscriberSession } from '@/src/features/subscriber/server'

type HeaderProps = {
  showSubscribeButton?: boolean
}

export default async function Header({ showSubscribeButton }: HeaderProps) {
  const resolvedShowSubscribeButton = showSubscribeButton ?? !(await hasActiveSubscriberSession())

  return <HeaderClient showSubscribeButton={resolvedShowSubscribeButton} />
}
