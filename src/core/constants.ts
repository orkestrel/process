/** Names the default cooperative POSIX window in milliseconds between `SIGTERM` and `SIGKILL` during termination. */
export const PROCESS_GRACE = 5_000

/** Names the window in milliseconds a termination waits for the child's native exit after the final kill. */
export const PROCESS_CONFIRMATION = 5_000

/**
 * Names the default window in milliseconds the package waits for the child's read ends to close after
 * the child's native exit or after a termination this package initiated, before cutting them off.
 *
 * @remarks
 * Measured on Windows 11 with Node v24.18.1 on 2026-08-21, spawning the `tests/src/server/fixtures`
 * child modes as real children and timing the host `close` event against the host `exit` event.
 * Every ordinary run closed within 0.02ms of the native exit, whether the child ended itself or a
 * kill ended it, and a `taskkill /F /T` that reaped a descendant while the root was still alive
 * closed within 0.01ms. The only finite late close came from a descendant that outlived its root and
 * then ended on its own, at 127.44ms to 193.41ms — that lag is the descendant's own remaining life
 * rather than a flush cost. A descendant that never ends never closes, so the distribution has no
 * finite tail to cover and this value bounds it instead: 1000ms is over five times the slowest
 * finite close measured, and it keeps an unreachable descendant from stretching a shutdown.
 */
export const PROCESS_DRAIN = 1_000

/** Names the default maximum retained stderr tail in bytes for a supervised {@link ProcessInterface}. */
export const PROCESS_EVIDENCE = 2_048

/** Names the default soft high-water mark in bytes for a supervised {@link ProcessInterface} line backlog. */
export const PROCESS_BACKLOG = 10_485_760

/** Names the default maximum captured bytes for a one-shot run's stdout and stderr, each. */
export const PROCESS_OUTPUT = 10_485_760

/** Names the largest timer delay in milliseconds the host schedules without truncating it to one. */
export const PROCESS_TIMER = 2_147_483_647

/** Lists the executable extensions a Windows lookup applies when the environment declares no `PATHEXT`. */
export const PROCESS_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** Lists the machine-readable failure categories a {@link ProcessError} carries, in declaration order. */
export const PROCESS_ERROR_CODES = Object.freeze([
	'spawn',
	'timeout',
	'input',
	'duplicate',
	'protocol',
	'invalid',
] as const)
