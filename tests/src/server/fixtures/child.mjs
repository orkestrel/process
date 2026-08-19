// A self-contained Node entrypoint spawned directly as a real child process, with no TypeScript
// transform or build step, so it imports no repository sibling. Each mode drives one observable
// behavior of the server tier under test.
import { createInterface } from 'node:readline'

const [mode = 'exit', detail = '0'] = process.argv.slice(2)

if (mode === 'chatty') {
	// Emit far more lines than any consumer reads promptly, then exit: the eager pump must drain
	// stdout with no consumer so exit still resolves and a late consumer receives every line.
	for (let index = 0; index < 4_096; index += 1) {
		process.stdout.write(`${String(index)}:${'x'.repeat(128)}\n`)
	}
	process.exit(0)
} else if (mode === 'partial-line') {
	process.stdout.write('first-line\n')
	// The final line carries no trailing newline: readline must still flush it as the last line.
	process.stdout.write('final-partial-line')
	process.exit(0)
} else if (mode === 'evidence') {
	// A long stderr stream ending in a marker: the live stderr event receives all of it while the
	// retained evidence tail is byte-bounded to its last bytes.
	process.stderr.write(`${'x'.repeat(4_096)}\n`)
	process.stderr.write('token=evidence-secret-tail')
	process.exit(7)
} else if (mode === 'unicode-evidence') {
	// A multibyte stream whose byte bound falls mid-sequence: the retained tail must not split a
	// UTF-8 code point and must end with the ASCII marker.
	process.stderr.write(`${'\u{1f642}'.repeat(1_024)}tail`)
	process.exit(7)
} else if (mode === 'sleep') {
	setInterval(() => undefined, 1_000)
	process.on('SIGTERM', () => process.exit(0))
} else if (mode === 'hang') {
	// No SIGTERM handler: a termination signal ends the process as a signal exit, so a caller that
	// terminates it observes a non-zero, signalled outcome rather than a graceful code 0.
	setInterval(() => undefined, 1_000)
} else if (mode === 'echo') {
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
	lines.on('line', (line) => {
		if (line === 'stop') {
			process.exit(0)
			return
		}
		process.stdout.write(`echo:${line}\n`)
	})
	process.on('SIGTERM', () => process.exit(0))
} else {
	// `exit <code>`: emit one stdout line and one stderr line, then exit with the requested code.
	process.stdout.write(`ran:${detail}\n`)
	process.stderr.write(`diagnostic:${detail}\n`)
	process.exit(Number.parseInt(detail, 10))
}
