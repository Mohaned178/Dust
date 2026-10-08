import { describe, expect, it } from 'vitest';
import { registryValueToBool, registryValueToString } from '../src/system/win-registry';
import type { RegistryValue } from '../src/system/win-registry';

const str = (value: string): RegistryValue => ({ type: 'string', value });
const expand = (value: string, raw = value): RegistryValue => ({ type: 'expand-string', value, raw });
const dword = (value: number): RegistryValue => ({ type: 'dword', value });
const qword = (value: number): RegistryValue => ({ type: 'qword', value });
const multi = (value: string[]): RegistryValue => ({ type: 'multi-string', value });
const binary = (...bytes: number[]): RegistryValue => ({ type: 'binary', value: Buffer.from(bytes) });
const other = (...bytes: number[]): RegistryValue => ({ type: 'other', value: Buffer.from(bytes) });

describe('registryValueToString (PowerShell [string])', () => {
  it('is empty for a missing value', () => {
    expect(registryValueToString(undefined)).toBe('');
  });

  it('returns strings as they are', () => {
    expect(registryValueToString(str('C:\\Program Files'))).toBe('C:\\Program Files');
    expect(registryValueToString(str(''))).toBe('');
  });

  it('returns the expanded text of an expand-string, not the raw one', () => {
    expect(registryValueToString(expand('C:\\Windows\\system32', '%SystemRoot%\\system32'))).toBe(
      'C:\\Windows\\system32',
    );
  });

  it('prints numbers in decimal', () => {
    expect(registryValueToString(dword(0))).toBe('0');
    expect(registryValueToString(dword(4_294_967_295))).toBe('4294967295');
    expect(registryValueToString(qword(8_589_934_592))).toBe('8589934592');
  });

  it('joins a multi-string with spaces', () => {
    expect(registryValueToString(multi(['a', 'b', 'c']))).toBe('a b c');
    expect(registryValueToString(multi([]))).toBe('');
    expect(registryValueToString(multi(['only']))).toBe('only');
  });

  it('prints binary and other values as space separated byte numbers', () => {
    expect(registryValueToString(binary(1, 0, 255))).toBe('1 0 255');
    expect(registryValueToString(binary())).toBe('');
    expect(registryValueToString(other(7, 8))).toBe('7 8');
  });
});

describe('registryValueToBool (PowerShell [bool])', () => {
  it('is false for a missing value', () => {
    expect(registryValueToBool(undefined)).toBe(false);
  });

  it('is true for any non-empty string, including "0"', () => {
    expect(registryValueToBool(str('yes'))).toBe(true);
    expect(registryValueToBool(str('0'))).toBe(true);
    expect(registryValueToBool(str(''))).toBe(false);
    expect(registryValueToBool(expand('x', '%X%'))).toBe(true);
    expect(registryValueToBool(expand('', '%EMPTY%'))).toBe(false);
  });

  it('is true for non-zero numbers only', () => {
    expect(registryValueToBool(dword(0))).toBe(false);
    expect(registryValueToBool(dword(1))).toBe(true);
    expect(registryValueToBool(dword(4_294_967_295))).toBe(true);
    expect(registryValueToBool(qword(0))).toBe(false);
    expect(registryValueToBool(qword(2 ** 40))).toBe(true);
  });

  it('is true for a non-empty multi-string', () => {
    expect(registryValueToBool(multi(['a', 'b']))).toBe(true);
    expect(registryValueToBool(multi([]))).toBe(false);
  });

  it('looks at the byte of a one-byte binary value and at the length of longer ones', () => {
    expect(registryValueToBool(binary(0))).toBe(false);
    expect(registryValueToBool(binary(1))).toBe(true);
    expect(registryValueToBool(binary(0, 0))).toBe(true);
    expect(registryValueToBool(binary())).toBe(false);
    expect(registryValueToBool(other(0))).toBe(false);
    expect(registryValueToBool(other(5))).toBe(true);
  });
});
