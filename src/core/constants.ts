/** The default cooperative window in milliseconds between `SIGTERM` and `SIGKILL` during termination. */
export const PROCESS_GRACE = 5_000

/** The default maximum retained stderr tail in bytes for a supervised {@link ProcessInterface}. */
export const PROCESS_EVIDENCE = 2_048

/** The default maximum captured bytes for a one-shot run's stdout and stderr, each. */
export const PROCESS_OUTPUT = 10_485_760
