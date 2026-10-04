import { expect, test } from 'claude-code/testing'

import { parseOutput } from '../hooks/parse'

const counts = (out: string) => {
  const p = parseOutput(out)
  return p === undefined ? undefined : { format: p.format, passed: p.passed, failed: p.failed, skipped: p.skipped, failing: p.failing }
}

test('jest', () => {
  const out = `FAIL src/auth.test.ts
  ● login › rejects a bad password

    expect(received).toBe(expected)

PASS src/util.test.ts

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 2 skipped, 41 passed, 44 total
Snapshots:   0 total
Time:        3.2 s`
  expect(counts(out)).toEqual({ format: 'jest', passed: 41, failed: 1, skipped: 2, failing: ['login › rejects a bad password'] })
})

test('vitest', () => {
  const out = ` ❯ tests/math.test.ts (3 tests | 1 failed) 12ms
   × math > divides by zero 5ms
 FAIL  tests/math.test.ts > math > divides by zero
AssertionError: expected Infinity to be +0

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 11 passed | 1 skipped (13)
   Start at  10:00:00`
  expect(counts(out)).toEqual({ format: 'vitest', passed: 11, failed: 1, skipped: 1, failing: ['math > divides by zero'] })
})

test('pytest', () => {
  const out = `tests/test_api.py ..F.
=================================== FAILURES ===================================
___________________________________ test_login ___________________________________
=========================== short test summary info ============================
FAILED tests/test_api.py::test_login - assert 401 == 200
ERROR tests/test_db.py::test_conn - ConnectionError
============ 1 failed, 40 passed, 2 skipped, 1 error in 3.21s ============`
  expect(counts(out)).toEqual({
    format: 'pytest', passed: 40, failed: 2, skipped: 2,
    failing: ['tests/test_api.py::test_login', 'tests/test_db.py::test_conn'],
  })
})

test('pytest all green, short form', () => {
  expect(counts('........\n============================== 8 passed in 0.12s ==============================')).toEqual({ format: 'pytest', passed: 8, failed: 0, skipped: 0, failing: [] })
})

test('python unittest', () => {
  const out = `..F.
======================================================================
FAIL: test_add (test_math.MathTest)
----------------------------------------------------------------------
Ran 4 tests in 0.002s

FAILED (failures=1)`
  expect(counts(out)).toEqual({ format: 'unittest', passed: 3, failed: 1, skipped: 0, failing: ['test_math.MathTest.test_add'] })
})

test('cargo sums every test binary', () => {
  const out = `running 3 tests
test tests::adds ... ok
test tests::divides ... FAILED
test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out

running 1 test
test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out`
  expect(counts(out)).toEqual({ format: 'cargo', passed: 3, failed: 1, skipped: 1, failing: ['tests::divides'] })
})

test('go test -v counts tests', () => {
  const out = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestDiv
--- FAIL: TestDiv (0.00s)
    math_test.go:12: want 2
FAIL
FAIL	example.com/math	0.004s`
  expect(counts(out)).toEqual({ format: 'go', passed: 1, failed: 1, skipped: 0, failing: ['TestDiv'] })
})

test('go test without -v counts packages', () => {
  const out = `ok  	example.com/a	0.010s
ok  	example.com/b	(cached)
--- FAIL: TestC (0.00s)
FAIL
FAIL	example.com/c	0.003s`
  expect(counts(out)).toEqual({ format: 'go (packages)', passed: 2, failed: 1, skipped: 0, failing: ['TestC'] })
})

test('mocha', () => {
  const out = `  Array
    ✓ has length
    1) sorts

  12 passing (40ms)
  1 failing
  2 pending

  1) Array
       sorts:
     AssertionError`
  const p = counts(out)!
  expect([p.format, p.passed, p.failed, p.skipped]).toEqual(['mocha', 12, 1, 2])
})

test('rspec', () => {
  const out = `Finished in 0.5 seconds
44 examples, 2 failures, 1 pending

Failed examples:

rspec ./spec/user_spec.rb:12 # User validates email
rspec ./spec/user_spec.rb:20 # User hashes password`
  expect(counts(out)).toEqual({ format: 'rspec', passed: 41, failed: 2, skipped: 1, failing: ['User validates email', 'User hashes password'] })
})

test('bun and claude plugin test', () => {
  const out = `tests/a.test.ts:
(pass) adds [0.1ms]
(fail) divides by zero [0.3ms]

 100 pass
 1 fail
Ran 101 tests across 2 files. [0.23s]`
  expect(counts(out)).toEqual({ format: 'bun', passed: 100, failed: 1, skipped: 0, failing: ['divides by zero'] })
})

test('node --test, spec reporter', () => {
  const out = `✔ adds (0.5ms)
✖ divides (1.2ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40

✖ failing tests:

test at a.test.js:5:1
✖ divides (1.2ms)`
  expect(counts(out)).toEqual({ format: 'node --test', passed: 1, failed: 1, skipped: 0, failing: ['divides'] })
})

test('node --test, TAP reporter', () => {
  const out = `ok 1 - adds
not ok 2 - divides
# tests 2
# pass 1
# fail 1
# skipped 0`
  expect(counts(out)).toEqual({ format: 'node --test', passed: 1, failed: 1, skipped: 0, failing: ['divides'] })
})

test('phpunit', () => {
  expect(counts('OK (12 tests, 30 assertions)')).toEqual({ format: 'phpunit', passed: 12, failed: 0, skipped: 0, failing: [] })
  const red = counts(`1) Tests\\UserTest::testEmail\nFailed asserting.\n\nFAILURES!\nTests: 12, Assertions: 30, Failures: 2, Errors: 1.`)!
  expect([red.passed, red.failed, red.failing[0]]).toEqual([9, 3, 'Tests\\UserTest::testEmail'])
})

test('dotnet sums projects', () => {
  const out = `  Failed Api.Tests.LoginTest [12 ms]
Failed!  - Failed:     1, Passed:    10, Skipped:     0, Total:    11, Duration: 1 s - Api.Tests.dll
Passed!  - Failed:     0, Passed:     5, Skipped:     1, Total:     6, Duration: 1 s - Core.Tests.dll`
  expect(counts(out)).toEqual({ format: 'dotnet', passed: 15, failed: 1, skipped: 1, failing: ['Api.Tests.LoginTest'] })
})

test('deno', () => {
  expect(counts('adds ... ok (2ms)\ndivides ... FAILED (1ms)\n\nFAILED | 1 passed | 1 failed (40ms)')).toEqual({ format: 'deno', passed: 1, failed: 1, skipped: 0, failing: ['divides'] })
})

test('maven reads the final summary', () => {
  const out = `[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.05 s - in com.x.ATest
[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.02 s <<< FAILURE! - in com.x.BTest
[INFO] Results:
[ERROR] Failures:
[ERROR]   BTest.testDivide:12 expected: <2> but was: <0>
[ERROR] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0`
  expect(counts(out)).toEqual({ format: 'maven', passed: 4, failed: 1, skipped: 0, failing: ['BTest.testDivide'] })
})

test('gradle', () => {
  const out = `MathTest > divides() FAILED
    org.opentest4j.AssertionFailedError

12 tests completed, 1 failed, 1 skipped`
  expect(counts(out)).toEqual({ format: 'gradle', passed: 10, failed: 1, skipped: 1, failing: ['MathTest > divides()'] })
})

test('colour codes are ignored', () => {
  expect(counts('\x1b[32m 3 pass\x1b[0m\n\x1b[31m 0 fail\x1b[0m')?.passed).toBe(3)
})

test('output with no summary is unknown', () => {
  expect(parseOutput('Compiling...\nDone.')).toBeUndefined()
})
