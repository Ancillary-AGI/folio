import { beforeEach, describe, expect, it } from 'vitest'
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
  readOnboardingStep,
  resetOnboarding,
  writeOnboardingStep,
} from './onboardingStorage'
import { clampOnboardingStep, ONBOARDING_STEPS } from './onboardingSteps'

beforeEach(() => {
  localStorage.clear()
})

describe('onboarding storage', () => {
  it('starts incomplete with step 0', () => {
    expect(hasCompletedOnboarding()).toBe(false)
    expect(readOnboardingStep(ONBOARDING_STEPS.length)).toBe(0)
  })

  it('round-trips progress and completion', () => {
    writeOnboardingStep(2)
    expect(readOnboardingStep(ONBOARDING_STEPS.length)).toBe(2)
    markOnboardingComplete()
    expect(hasCompletedOnboarding()).toBe(true)
    // Completion clears the resume point.
    expect(readOnboardingStep(ONBOARDING_STEPS.length)).toBe(0)
  })

  it('resets completion so the tour can be reopened', () => {
    markOnboardingComplete()
    resetOnboarding()
    expect(hasCompletedOnboarding()).toBe(false)
  })

  it('ignores corrupt or out-of-range stored steps', () => {
    localStorage.setItem('folio.onboarding.step', 'not-a-number')
    expect(readOnboardingStep(3)).toBe(0)
    localStorage.setItem('folio.onboarding.step', '-4')
    expect(readOnboardingStep(3)).toBe(0)
    localStorage.setItem('folio.onboarding.step', '99')
    expect(readOnboardingStep(3)).toBe(2)
  })
})

describe('onboarding steps', () => {
  it('clamps step indices into the available range', () => {
    const last = ONBOARDING_STEPS.length - 1
    expect(clampOnboardingStep(-1)).toBe(0)
    expect(clampOnboardingStep(1)).toBe(1)
    expect(clampOnboardingStep(last + 20)).toBe(last)
    expect(clampOnboardingStep(0.5)).toBe(0)
  })

  it('has unique ids and a non-empty checklist per step', () => {
    expect(new Set(ONBOARDING_STEPS.map(step => step.id)).size).toBe(ONBOARDING_STEPS.length)
    expect(ONBOARDING_STEPS.every(step => step.checklist.length > 0)).toBe(true)
  })
})
