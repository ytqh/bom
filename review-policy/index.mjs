import { pathToFileURL } from 'node:url';
import { ActionError, runReviewPolicy } from '../review/index.mjs';

export const run = runReviewPolicy;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await run();
    console.log(`Review policy check conclusion: ${result.conclusion}.`);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(`::error::${error instanceof ActionError ? error.message : 'Review policy action failed.'}`);
    process.exitCode = 1;
  }
}
