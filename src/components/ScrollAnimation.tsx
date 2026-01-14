'use client'
import { useEffect, useRef, useState } from 'react';

interface ScrollAnimationProps {
  children: React.ReactNode;
  className?: string;
  animationType?: 'fade-in' | 'scale' | 'slide-left' | 'slide-right';
  delay?: number;
}

export default function ScrollAnimation({ 
  children, 
  className = '', 
  animationType = 'fade-in',
  delay = 0 
}: ScrollAnimationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if element is already in viewport on mount
    const checkInitialVisibility = () => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect();
        const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
        if (isInViewport) {
          setTimeout(() => {
            setIsVisible(true);
          }, delay);
        }
      }
    };

    // Check immediately
    checkInitialVisibility();

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            setIsVisible(true);
          }, delay);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '0px',
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, [delay]);

  const animationClass = `observe-${animationType} ${isVisible ? 'visible' : ''}`;

  return (
    <div ref={ref} className={`${animationClass} ${className}`}>
      {children}
    </div>
  );
}

