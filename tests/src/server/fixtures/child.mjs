// A self-contained Node entrypoint spawned directly as a real child process, with no TypeScript
// transform or build step, so it imports no repository sibling. Each mode drives one observable
// behavior of the server tier under test.
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [mode = 'exit', detail = '0'] = process.argv.slice(2)
// The raw third argument, which is `undefined` when the caller passed none. `detail` carries a
// default for the modes that need one, so a mode whose behavior changes on presence alone reads
// this instead.
const passed = process.argv[3]

if (mode === 'write') {
	// Write a marker file and exit, so a caller with no handle on this process can still observe
	// that it ran.
	writeFileSync(detail, 'detached')
	process.exit(0)
} else if (mode === 'delayed-write') {
	// Announce that this grandchild is established before arming its write. The root's timeout is
	// shorter than Node's own bootstrap on some hosts, so a test that does not wait for this line is
	// racing interpreter startup rather than measuring termination.
	writeFileSync(`${detail}.ready`, 'ready')
	// Delay the observable write until after the root's timeout, so a caller can distinguish a
	// surviving grandchild from one the tree termination reached.
	setTimeout(() => {
		writeFileSync(detail, 'grandchild')
		process.exit(0)
	}, 250)
} else if (mode === 'announce') {
	// Publish this process id to a file and stay alive, so a caller holding no handle on this process
	// can still ask the host whether it is still running.
	writeFileSync(detail, String(process.pid))
	setInterval(() => undefined, 1_000)
	process.on('SIGTERM', () => process.exit(0))
} else if (mode === 'args') {
	// Echo every argument after the mode, so a caller can prove a shell never split or interpreted
	// one of them.
	process.stdout.write(`args:${process.argv.slice(3).join('|')}\n`)
	process.exit(0)
} else if (mode === 'environment') {
	// Report one variable's value and the whole environment size, so a caller can prove both an
	// override and an isolated environment.
	process.stdout.write(`value:${process.env[detail] ?? ''}\n`)
	process.exit(0)
} else if (
	mode === 'tree' ||
	mode === 'orphan' ||
	mode === 'orphan-late' ||
	mode === 'orphan-partial'
) {
	// Spawn a grandchild that inherits this process's stdout, so the pipe outlives this process.
	// `tree` keeps the root alive for a tree kill; every `orphan` shape lets the root exit while the
	// pipe is still held, which is the state that keeps a close event pending forever.
	//
	// Each host is given the descendant its own tree mechanism must reach. On Windows a
	// non-detached grandchild dies with its root, which no `taskkill /T` is needed for, so the
	// grandchild is detached and survives. On POSIX a detached grandchild leads a new session and
	// escapes the process group, so it stays in the group instead.
	//
	// The holder decides how the held pipe is released. `sleep` never releases it, so the close
	// event never arrives. `hold <ms>` releases it after a bounded window, so a caller can put a
	// drain bound on either side of a real release. `late <path>` keeps writing diagnostics into the
	// held pipe and appends the same bytes to a file, so a caller can prove late bytes existed.
	let holder = ['sleep']
	if (mode === 'orphan-late') holder = ['late', detail]
	else if (passed !== undefined) holder = ['hold', passed]
	const grandchild = spawn(process.argv[0], [process.argv[1], ...holder], {
		stdio: ['ignore', 1, 2],
		detached: process.platform === 'win32',
	})
	grandchild.unref()
	process.stdout.write(`grandchild:${String(grandchild.pid)}\n`)
	if (mode === 'tree') {
		setInterval(() => undefined, 1_000)
	} else {
		process.stdout.write('exiting\n')
		if (mode === 'orphan-partial') {
			// One framed line and one unterminated line, written last. Only the stream's own end
			// flushes a trailing partial, and this stream never ends while the grandchild holds it.
			process.stdout.write('kept-line\n')
			process.stdout.write('unterminated-final')
		}
		setTimeout(() => process.exit(0), 50)
	}
} else if (mode === 'hold') {
	// Hold the inherited stdout and stderr pipes for the requested window, then release them by
	// exiting. A caller reads the release as the host close event it defers until this instant.
	setTimeout(() => process.exit(0), Number.parseInt(detail, 10))
	process.on('SIGTERM', () => process.exit(0))
} else if (mode === 'late') {
	// Write one marker to the inherited stderr and append the same bytes to the caller's file at the
	// same instant. A caller that sees the file grow after a barrier knows bytes reached the pipe
	// after it too, so a frozen tail is a frozen tail rather than an absence of anything to read.
	// The held pipe's destruction must not end the file-side proof, so swallow the stream error it
	// otherwise raises.
	process.stderr.on('error', () => undefined)
	let index = 0
	setInterval(() => {
		const marker = `late:${String(index)}\n`
		index += 1
		process.stderr.write(marker)
		appendFileSync(detail, marker)
	}, 20)
	process.on('SIGTERM', () => process.exit(0))
} else if (mode === 'tree-write') {
	// The grandchild writes only after the root's timeout. A root-only timeout leaves the marker;
	// tree termination reaches the grandchild before it can write.
	const grandchild = spawn(process.argv[0], [process.argv[1], 'delayed-write', detail], {
		stdio: ['ignore', 1, 2],
		detached: process.platform === 'win32',
	})
	grandchild.unref()
	setInterval(() => undefined, 1_000)
} else if (mode === 'chatty') {
	// Emit far more lines than any consumer reads promptly, then let stdout flush: the eager pump
	// must drain with no consumer so exit still resolves and a late consumer receives every line.
	for (let index = 0; index < 4_096; index += 1) {
		process.stdout.write(`${String(index)}:${'x'.repeat(128)}\n`)
	}
} else if (mode === 'empty') {
	// Emit a flood of empty lines and let stdout flush. Every line carries zero payload bytes, so only
	// a backlog that charges each retained line its own framing cost can bound this stream.
	for (let index = 0; index < 50_000; index += 1) process.stdout.write('\n')
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
} else if (mode === 'trap') {
	// Trap SIGTERM with a no-op and keep running: the cooperative signal is delivered and ignored, so
	// only an escalation to SIGKILL ends this process.
	setInterval(() => undefined, 1_000)
	process.on('SIGTERM', () => undefined)
	process.stdout.write('trapped\n')
} else if (mode === 'flood') {
	// Trap the cooperative signal and keep producing framed output while termination drains stdout.
	// The bounded parent must drop beyond its teardown cap without pausing this stream again.
	let index = 0
	process.on('SIGTERM', () => undefined)
	process.stdout.write('ready\n')
	setInterval(() => {
		for (let count = 0; count < 256; count += 1) {
			process.stdout.write(`${String(index)}:${'x'.repeat(128)}\n`)
			index += 1
		}
	}, 1)
} else if (mode === 'hang') {
	// No SIGTERM handler: a termination signal ends the process as a signal exit, so a caller that
	// terminates it observes a non-zero, signalled outcome rather than a graceful code 0.
	setInterval(() => undefined, 1_000)
} else if (mode === 'raw-echo') {
	// Echo every stdin byte straight back to stdout, adding no terminator and decoding nothing, then
	// exit when the channel closes. A caller reads byte fidelity off the echo, and reads the exit as
	// the child ending itself because its input ended — never because anything terminated it.
	process.stdin.on('data', (chunk) => process.stdout.write(chunk))
	process.stdin.on('end', () => process.exit(0))
	process.on('SIGTERM', () => process.exit(0))
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
