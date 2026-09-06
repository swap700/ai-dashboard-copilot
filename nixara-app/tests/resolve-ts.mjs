/**
 * ESM resolve hook: lets the test files import app modules that use
 * extensionless relative specifiers.
 *
 * The app is written for a bundler, so lib/data-analysis.ts does
 * `import ... from "./format"`. Turbopack resolves that; bare Node's ESM
 * resolver does not, and requires "./format.ts". Rather than rewrite app
 * source to suit the test runner, this hook retries a failed relative
 * resolution with the TypeScript extensions appended.
 *
 * Kept dependency-free on purpose - the whole point of this harness is that
 * it runs with nothing but Node.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") || !context.parentURL) throw error;

    for (const extension of EXTENSIONS) {
      const candidate = new URL(specifier + extension, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    throw error;
  }
}
