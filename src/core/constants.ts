/** The default cooperative POSIX window in milliseconds between `SIGTERM` and `SIGKILL` during termination. */
export const PROCESS_GRACE = 5_000

/** The window in milliseconds a termination waits for the child's native exit after the final kill. */
export const PROCESS_CONFIRMATION = 5_000

/** The default maximum retained stderr tail in bytes for a supervised {@link ProcessInterface}. */
export const PROCESS_EVIDENCE = 2_048

/** The default soft high-water mark in bytes for a supervised {@link ProcessInterface} line backlog. */
export const PROCESS_BACKLOG = 10_485_760

/** The default maximum captured bytes for a one-shot run's stdout and stderr, each. */
export const PROCESS_OUTPUT = 10_485_760

/** The largest timer delay in milliseconds the host schedules without truncating it to one. */
export const PROCESS_TIMER = 2_147_483_647

/** The executable extensions a Windows lookup applies when the environment declares no `PATHEXT`. */
export const PROCESS_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** The machine-readable failure categories a {@link ProcessError} carries, in declaration order. */
export const PROCESS_ERROR_CODES = Object.freeze([
	'spawn',
	'timeout',
	'input',
	'duplicate',
	'protocol',
	'invalid',
] as const)
