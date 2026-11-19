import { describe, expect, it } from 'vitest';
import { redirectTarget } from '../pages/auth/redirect';

const target = (redirect: string) => redirectTarget({ query: { redirect } });

describe('redirect after signing in', () => {
  it('follows a same-site path with its query and hash', () => {
    expect(target('/security?tab=x')).toBe('/security?tab=x');
    expect(target('/projects/p1/board?task=t1#comments')).toBe('/projects/p1/board?task=t1#comments');
  });

  it.each([
    '/\\evil.example',
    '/%5Cevil.example',
    '/%5cevil.example',
    '%2F%5Cevil.example',
    '/%09/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/%00/evil.example',
    '/%1F/evil.example',
    '/%7F/evil.example',
    '/\u007f/evil.example',
    // An encoding that cannot be decoded cannot be checked either.
    '/%E0%A4%A',
    '//evil.example',
    'https://evil.example',
  ])('refuses %j and goes to the dashboard', (redirect) => {
    expect(target(redirect)).toBe('/dashboard');
  });

  it('goes to the dashboard without a redirect', () => {
    expect(redirectTarget({ query: {} })).toBe('/dashboard');
  });
});
