// Generates a CodeBuild buildspec from what a repo's top folder holds. Pure.

export type ProjectFiles = {
  /** Names of the files and folders at the build root. */
  names: readonly string[]
  /** package.json, parsed, when there is one. */
  packageJson?: { scripts?: Record<string, string>; engines?: { node?: string }; packageManager?: string }
  /** The contents of .nvmrc / .node-version, when present. */
  nodeVersion?: string
  /** The contents of .python-version, when present. */
  pythonVersion?: string
  /** The Makefile, when present. */
  makefile?: string
}

export type Plan = {
  /** What was detected, for people: `node (npm)`, `python`, `go`. */
  stack: string[]
  /** The buildspec, as YAML. */
  yaml: string
  /** Whether the build needs Docker (privileged mode). */
  needsDocker: boolean
}

// Runtimes the CodeBuild Amazon Linux 2023 standard:5.0 image can switch to.
const NODE = ['18', '20', '22']
const PYTHON = ['3.11', '3.12', '3.13']

const has = (files: ProjectFiles, name: string) => files.names.includes(name)
const isRealScript = (script: string | undefined) => script !== undefined && !/no test specified/.test(script)

function major(version: string | undefined, known: readonly string[]): string | undefined {
  const found = String(version ?? '').match(/(\d+)(?:\.(\d+))?/)
  if (found === null) return undefined
  const twoPart = `${found[1]}.${found[2] ?? ''}`
  return known.includes(found[1]!) ? found[1] : known.includes(twoPart) ? twoPart : undefined
}

export function planBuild(files: ProjectFiles): Plan {
  const runtimes: Record<string, string> = {}
  const install: string[] = []
  const build: string[] = []
  const stack: string[] = []
  let needsDocker = false

  if (has(files, 'package.json')) {
    const pkg = files.packageJson ?? {}
    const scripts = pkg.scripts ?? {}
    const pm = has(files, 'pnpm-lock.yaml') || String(pkg.packageManager).startsWith('pnpm') ? 'pnpm'
      : has(files, 'yarn.lock') || String(pkg.packageManager).startsWith('yarn') ? 'yarn'
      : 'npm'
    stack.push(`node (${pm})`)
    const node = major(files.nodeVersion ?? pkg.engines?.node, NODE)
    if (node !== undefined) runtimes.nodejs = node
    if (pm === 'pnpm') install.push('corepack enable', 'pnpm install --frozen-lockfile')
    else if (pm === 'yarn') install.push('corepack enable', has(files, '.yarnrc.yml') ? 'yarn install --immutable' : 'yarn install --frozen-lockfile')
    else install.push(has(files, 'package-lock.json') ? 'npm ci' : 'npm install')
    const run = pm === 'npm' ? 'npm run' : pm
    if (scripts.lint !== undefined) build.push(`${run} lint`)
    if (scripts.build !== undefined) build.push(`${run} build`)
    if (isRealScript(scripts.test)) build.push(pm === 'npm' ? 'npm test' : `${pm} test`)
  }

  const isPython = has(files, 'pyproject.toml') || has(files, 'requirements.txt') || has(files, 'setup.py')
  if (isPython) {
    stack.push('python')
    const python = major(files.pythonVersion, PYTHON)
    if (python !== undefined) runtimes.python = python
    install.push('python -m pip install --upgrade pip')
    if (has(files, 'requirements.txt')) install.push('pip install -r requirements.txt')
    if (has(files, 'requirements-dev.txt')) install.push('pip install -r requirements-dev.txt')
    if (has(files, 'pyproject.toml') || has(files, 'setup.py')) install.push('pip install -e .')
    if (has(files, 'tests') || has(files, 'test') || has(files, 'pytest.ini') || has(files, 'conftest.py')) {
      install.push('pip install pytest')
      build.push('python -m pytest')
    }
  }

  if (has(files, 'go.mod')) {
    stack.push('go')
    build.push('go build ./...', 'go test ./...')
  }

  if (has(files, 'Cargo.toml')) {
    stack.push('rust')
    install.push('curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal', '. "$HOME/.cargo/env"')
    build.push('cargo build --locked', 'cargo test --locked')
  }

  if (has(files, 'pom.xml')) {
    stack.push('java (maven)')
    runtimes.java = 'corretto21'
    build.push('mvn -B -ntp verify')
  } else if (has(files, 'build.gradle') || has(files, 'build.gradle.kts')) {
    stack.push('java (gradle)')
    runtimes.java = 'corretto21'
    build.push(has(files, 'gradlew') ? 'chmod +x gradlew && ./gradlew build' : 'gradle build')
  }

  if (files.names.some(n => n.endsWith('.sln') || n.endsWith('.csproj'))) {
    stack.push('.net')
    build.push('dotnet build', 'dotnet test')
  }

  if (has(files, 'Gemfile')) {
    stack.push('ruby')
    install.push('bundle install')
    build.push(has(files, 'Rakefile') ? 'bundle exec rake' : 'bundle exec rspec')
  }

  if (build.length === 0 && has(files, 'Makefile')) {
    stack.push('make')
    build.push('make')
    if (/^test\s*:/m.test(files.makefile ?? '')) build.push('make test')
  }

  if (build.length === 0 && has(files, 'Dockerfile')) {
    stack.push('docker')
    needsDocker = true
    build.push('docker build -t app .')
  }

  if (build.length === 0) {
    stack.push('unknown')
    build.push('echo "No build detected: add a buildspec.yml (/codebuild buildspec save writes a starter)."', 'ls -la')
  }

  const lines = ['version: 0.2', '# Generated by the codebuild mod for Claude Code. Save it as buildspec.yml to customise.', 'phases:']
  if (Object.keys(runtimes).length > 0 || install.length > 0) {
    lines.push('  install:')
    if (Object.keys(runtimes).length > 0) {
      lines.push('    runtime-versions:')
      for (const [name, version] of Object.entries(runtimes)) lines.push(`      ${name}: ${version}`)
    }
    if (install.length > 0) {
      lines.push('    commands:')
      for (const command of install) lines.push(`      - ${yamlString(command)}`)
    }
  }
  lines.push('  build:', '    commands:')
  for (const command of build) lines.push(`      - ${yamlString(command)}`)

  return { stack, yaml: lines.join('\n') + '\n', needsDocker }
}

/** A command as a YAML scalar: quoted when YAML would read it as something else. */
export function yamlString(text: string): string {
  return /^[\w./-][^:#{}[\],&*!|>'"%@`]*$/.test(text) && !/\s$/.test(text) ? text : JSON.stringify(text)
}
