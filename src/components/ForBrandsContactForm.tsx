'use client'

import { FormEvent, useEffect, useState } from 'react'

type FormState = {
  name: string
  workEmail: string
  website: string
  whoYouWantToReach: string
  mainGoal: string
  extraContext: string
}

const INITIAL_STATE: FormState = {
  name: '',
  workEmail: '',
  website: '',
  whoYouWantToReach: '',
  mainGoal: '',
  extraContext: '',
}

type ErrorState = Partial<Record<keyof FormState, string>>

type ApiErrorResponse = {
  error?: string
  fieldErrors?: ErrorState
}

const REQUIRED_FIELDS: Array<keyof FormState> = [
  'name',
  'workEmail',
  'website',
  'whoYouWantToReach',
  'mainGoal',
]

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isValidWebsite(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return false
  }

  return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(trimmed)
}

function getFieldError(field: keyof FormState, value: string) {
  const trimmed = value.trim()

  if (REQUIRED_FIELDS.includes(field) && !trimmed) {
    return 'This field is required.'
  }

  if (field === 'workEmail' && trimmed && !isValidEmail(trimmed)) {
    return 'Enter a valid work email.'
  }

  if (field === 'website' && trimmed && !isValidWebsite(trimmed)) {
    return 'Enter a valid website, like example.com.'
  }

  return ''
}

export default function ForBrandsContactForm() {
  const [formState, setFormState] = useState<FormState>(INITIAL_STATE)
  const [errors, setErrors] = useState<ErrorState>({})
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({})
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!message || status === 'submitting') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setMessage('')

      if (status === 'success') {
        setStatus('idle')
      }
    }, 3600)

    return () => window.clearTimeout(timeoutId)
  }, [message, status])

  const validateForm = (nextState: FormState) => {
    const nextErrors: ErrorState = {}

    for (const field of REQUIRED_FIELDS) {
      const error = getFieldError(field, nextState[field])

      if (error) {
        nextErrors[field] = error
      }
    }

    return nextErrors
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateForm(formState)

    setTouched({
      name: true,
      workEmail: true,
      website: true,
      whoYouWantToReach: true,
      mainGoal: true,
      extraContext: true,
    })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setStatus('error')
      setMessage('Please fix the marked fields and try again.')
      return
    }

    setStatus('submitting')
    setMessage('')

    try {
      const response = await fetch('/api/for-brands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formState),
      })

      const data = (await response.json().catch(() => null)) as ApiErrorResponse | null

      if (!response.ok) {
        if (data?.fieldErrors) {
          setErrors((current) => ({
            ...current,
            ...data.fieldErrors,
          }))
        }
        throw new Error(data?.error || 'Something went wrong.')
      }

      setStatus('success')
      setMessage('Thanks. Your note is in. We will follow up soon.')
      setFormState(INITIAL_STATE)
      setErrors({})
      setTouched({})
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : 'Something went wrong. Please try again.'

      setStatus('error')
      setMessage(nextMessage)
    }
  }

  const updateField = (field: keyof FormState, value: string) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }))

    if (touched[field]) {
      setErrors((current) => ({
        ...current,
        [field]: getFieldError(field, value),
      }))
    }
  }

  const handleBlur = (field: keyof FormState) => {
    setTouched((current) => ({
      ...current,
      [field]: true,
    }))

    setErrors((current) => ({
      ...current,
      [field]: getFieldError(field, formState[field]),
    }))
  }

  const getInputClassName = (field: keyof FormState) => {
    const hasError = Boolean(touched[field] && errors[field])

    return `rounded border px-4 py-3 text-white outline-none transition-colors placeholder:text-white/38 ${
      hasError
        ? 'border-[#FFD4D4] bg-[rgba(127,40,51,0.22)] focus:border-[#FFD4D4]'
        : 'border-white/16 bg-white/6 focus:border-white/32'
    }`
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="relative grid gap-4">
      {message ? (
        <div
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 max-w-[360px] rounded-lg border px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-sm ${
            status === 'success'
              ? 'border-[rgba(157,180,160,0.45)] bg-[rgba(43,60,68,0.94)] text-white'
              : 'border-[rgba(255,212,212,0.45)] bg-[rgba(78,44,52,0.96)] text-[#FFE0E0]'
          }`}
          style={{ fontSize: 'var(--text-small)' }}
        >
          {message}
        </div>
      ) : null}

      <p className="text-white/62" style={{ fontSize: 'var(--text-small)' }}>
        <span className="text-white">*</span> Required fields
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="font-semibold text-white" style={{ fontSize: 'var(--text-small)' }}>
            Name <span className="text-white/68">*</span>
          </span>
          <input
            type="text"
            value={formState.name}
            onChange={(event) => updateField('name', event.target.value)}
            onBlur={() => handleBlur('name')}
            className={getInputClassName('name')}
            placeholder="Your name"
            aria-invalid={Boolean(touched.name && errors.name)}
            required
          />
        </label>

        <label className="grid gap-2">
          <span className="font-semibold text-white" style={{ fontSize: 'var(--text-small)' }}>
            Work email <span className="text-white/68">*</span>
          </span>
          <input
            type="email"
            value={formState.workEmail}
            onChange={(event) => updateField('workEmail', event.target.value)}
            onBlur={() => handleBlur('workEmail')}
            className={getInputClassName('workEmail')}
            placeholder="you@company.com"
            aria-invalid={Boolean(touched.workEmail && errors.workEmail)}
            required
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <label className="grid gap-2">
          <span className="font-semibold text-white" style={{ fontSize: 'var(--text-small)' }}>
            Website <span className="text-white/68">*</span>
          </span>
          <input
            type="text"
            value={formState.website}
            onChange={(event) => updateField('website', event.target.value)}
            onBlur={() => handleBlur('website')}
            className={getInputClassName('website')}
            placeholder="example.com"
            aria-invalid={Boolean(touched.website && errors.website)}
            required
          />
        </label>

        <label className="grid gap-2">
          <span className="font-semibold text-white" style={{ fontSize: 'var(--text-small)' }}>
            Who do you want to reach? <span className="text-white/68">*</span>
          </span>
          <input
            type="text"
            value={formState.whoYouWantToReach}
            onChange={(event) => updateField('whoYouWantToReach', event.target.value)}
            onBlur={() => handleBlur('whoYouWantToReach')}
            className={getInputClassName('whoYouWantToReach')}
            placeholder="Your target audience"
            aria-invalid={Boolean(touched.whoYouWantToReach && errors.whoYouWantToReach)}
            required
          />
        </label>
      </div>

      <label className="grid gap-2">
        <span className="font-semibold text-white" style={{ fontSize: 'var(--text-small)' }}>
          What should the newsletter help you do? <span className="text-white/68">*</span>
        </span>
        <textarea
          value={formState.mainGoal}
          onChange={(event) => updateField('mainGoal', event.target.value)}
          onBlur={() => handleBlur('mainGoal')}
          className={`min-h-[108px] ${getInputClassName('mainGoal')}`}
          placeholder="Get more leads, grow trust, build search traffic, support sales, or all of the above"
          aria-invalid={Boolean(touched.mainGoal && errors.mainGoal)}
          required
        />
      </label>

      <label className="grid gap-2">
        <span className="font-semibold text-white" style={{ fontSize: 'var(--text-small)' }}>
          Anything else we should know?
        </span>
        <textarea
          value={formState.extraContext}
          onChange={(event) => updateField('extraContext', event.target.value)}
          onBlur={() => handleBlur('extraContext')}
          className={`min-h-[96px] ${getInputClassName('extraContext')}`}
          placeholder="Optional context"
        />
      </label>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="inline-flex items-center justify-center rounded border border-white bg-white px-6 py-3 font-semibold text-[var(--text-primary)] transition-colors duration-200 hover:bg-[var(--bg-warm)] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {status === 'submitting' ? 'Sending...' : 'Get in touch'}
        </button>

        <p className="text-white/62" style={{ fontSize: 'var(--text-small)' }}>
          We will use this to see if the fit is right.
        </p>
      </div>

    </form>
  )
}
