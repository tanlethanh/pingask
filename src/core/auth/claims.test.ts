import { describe, expect, test } from 'bun:test'
import { accountIdOf, readClaims, residencyOf } from './claims.ts'

const jwt = (payload: unknown): string => {
  const body = btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return `header.${body}.signature`
}

describe('readClaims', () => {
  test('reads the payload of a token', () => {
    expect(readClaims(jwt({ chatgpt_account_id: 'acc_1' }))).toEqual({
      chatgpt_account_id: 'acc_1',
    })
  })

  test('is undefined for anything that is not a readable token', () => {
    expect(readClaims(undefined)).toBeUndefined()
    expect(readClaims('')).toBeUndefined()
    expect(readClaims('not-a-jwt')).toBeUndefined()
    expect(readClaims('header.$$$.signature')).toBeUndefined()
  })
})

describe('accountIdOf', () => {
  test('prefers the top-level claim, then the namespaced one, then the first org', () => {
    expect(accountIdOf({ chatgpt_account_id: 'top' })).toBe('top')
    expect(accountIdOf({ 'https://api.openai.com/auth': { chatgpt_account_id: 'ns' } })).toBe('ns')
    expect(accountIdOf({ organizations: [{ id: 'org_1' }, { id: 'org_2' }] })).toBe('org_1')
    expect(accountIdOf(undefined)).toBeUndefined()
  })
})

describe('residencyOf', () => {
  test('reads the namespaced claim ahead of the top-level one', () => {
    expect(
      residencyOf({
        chatgpt_compute_residency: 'us',
        'https://api.openai.com/auth': { chatgpt_compute_residency: 'eu' },
      }),
    ).toBe('eu')
    expect(residencyOf({ chatgpt_compute_residency: 'us' })).toBe('us')
  })

  // An unconstrained account must send no header at all, not `no_constraint`.
  test('treats no_constraint and a missing claim as no residency', () => {
    expect(residencyOf({ chatgpt_compute_residency: 'no_constraint' })).toBeUndefined()
    expect(residencyOf({})).toBeUndefined()
    expect(residencyOf(undefined)).toBeUndefined()
  })
})
