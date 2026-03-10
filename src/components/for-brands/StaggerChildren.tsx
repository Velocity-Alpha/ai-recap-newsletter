'use client'

import { ReactNode } from 'react'
import { motion } from 'framer-motion'

interface StaggerChildrenProps {
  children: ReactNode
  className?: string
  staggerDelay?: number
  initialDelay?: number
}

const container = {
  hidden: {},
  show: (custom: { staggerDelay: number; initialDelay: number }) => ({
    transition: {
      staggerChildren: custom.staggerDelay,
      delayChildren: custom.initialDelay,
    },
  }),
}

export const staggerItem = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    },
  },
}

export default function StaggerChildren({
  children,
  className = '',
  staggerDelay = 0.12,
  initialDelay = 0,
}: StaggerChildrenProps) {
  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      custom={{ staggerDelay, initialDelay }}
    >
      {children}
    </motion.div>
  )
}
