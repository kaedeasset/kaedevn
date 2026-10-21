/**
 * KSC Language Restrictions
 *
 * Banned features and properties for platform safety (Switch PF)
 * and sandbox integrity.
 */

// ---- Permanently banned property names ----
// Access to these via GET_FIELD / SET_FIELD is always a runtime error.

export const BANNED_PROPERTIES: ReadonlySet<string> = new Set([
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'constructor',    // Blocked until class support provides controlled access
  'prototype',      // Blocked until class support provides controlled access
]);

// ---- Permanently banned identifiers (parser-level) ----
// Using these as function calls or identifiers triggers a parse error.

export const BANNED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'eval',
  'Function',
]);

// ---- Permanently banned syntax (parser-level) ----
// These language constructs are not supported in KSC.

export const BANNED_KEYWORDS: ReadonlySet<string> = new Set([
  'with',       // Scope pollution
  'eval',       // Sandbox escape
]);

// ---- Initially banned (may be reconsidered when classes are added) ----

export const INITIALLY_BANNED_METHODS: ReadonlySet<string> = new Set([
  'call',
  'apply',
  'bind',
]);

/**
 * Check if a property name is banned for field access.
 */
export function isBannedProperty(name: string): boolean {
  return BANNED_PROPERTIES.has(name);
}

/**
 * Check if an identifier is banned from use as a callee.
 */
export function isBannedIdentifier(name: string): boolean {
  return BANNED_IDENTIFIERS.has(name);
}
