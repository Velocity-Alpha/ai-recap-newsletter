'use client'

import { ReactNode } from 'react'
import { motion } from 'framer-motion'

interface TextRevealProps {
  children: ReactNode
  className?: string
  delay?: number
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span'
  style?: React.CSSProperties
}

export default function TextReveal({
  children,
  className = '',
  delay = 0,
  as = 'h1',
  style,
}: TextRevealProps) {
  const Tag = motion[as] as typeof motion.h1

  return (
    <div className="overflow-hidden">
      <Tag
        className={className}
        style={style}
        initial={{ y: '100%', opacity: 0 }}
        whileInView={{ y: 0, opacity: 1 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{
          duration: 0.8,
          delay,
          ease: [0.33, 1, 0.68, 1],
        }}
      >
        {children}
      </Tag>
    </div>
  )
}
