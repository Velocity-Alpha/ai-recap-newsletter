'use client'

import AnimatedCounter from '@/components/for-brands/AnimatedCounter'
import FadeInView from '@/components/for-brands/FadeInView'

const stats = [
  { value: 5, suffix: ' min', label: 'Your weekly commitment' },
  { value: 50, suffix: '%', label: 'Average open rate' },
  { value: 100, suffix: '%', label: 'Owned by you, not an algorithm' },
]

type StatsBarProps = {
  className?: string
}

export default function StatsBar({ className = '' }: StatsBarProps) {
  return (
    <FadeInView className={className}>
      <div className="rounded-[28px] border border-white/10 bg-white/95 px-6 py-8 shadow-[0_20px_80px_rgba(11,23,35,0.18)] backdrop-blur-sm sm:px-10">
        <div className="grid divide-y divide-[var(--border-light)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {stats.map((stat) => (
            <div key={stat.label} className="px-4 py-5 text-center sm:py-2">
              <div className="mb-2 font-serif text-[clamp(32px,4vw,44px)] font-normal leading-none tracking-tight text-[var(--text-primary)]">
                <AnimatedCounter end={stat.value} suffix={stat.suffix} duration={1.5} />
              </div>
              <div className="text-sm text-[var(--text-muted)]">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </FadeInView>
  )
}
