import { describe, expect, test } from 'claude-code/testing'

import { npmName, parseInstalls, pypiName } from '../hooks/parse'

const names = (command: string) => parseInstalls(command).installs.map(i => `${i.ecosystem}:${i.name}${i.isRun ? '!' : ''}`)

describe('finds the packages an install names', () => {
  const cases: Array<[string, string[]]> = [
    ['npm install left-pad', ['npm:left-pad']],
    ['npm i -D typescript@5 @types/node@^22', ['npm:typescript', 'npm:@types/node']],
    ['npm install --save-dev --workspace web eslint', ['npm:eslint']],
    ['npm add react react-dom', ['npm:react', 'npm:react-dom']],
    ['pnpm add -D vitest', ['npm:vitest']],
    ['pnpm --filter api add zod', []],
    ['yarn add lodash@4.17.21', ['npm:lodash']],
    ['yarn global add serve', ['npm:serve']],
    ['bun add hono', ['npm:hono']],
    ['npx create-vite@latest my-app', ['npm:create-vite!']],
    ['npx --yes cowsay hi', ['npm:cowsay!']],
    ['npx -p @scope/tool tool --help', ['npm:@scope/tool!']],
    ['pnpm dlx degit user/repo', ['npm:degit!']],
    ['bunx prisma generate', ['npm:prisma!']],
    ['npm install my-alias@npm:real-package@1', ['npm:real-package']],
    ['pip install requests', ['pypi:requests']],
    ['pip3 install "Django>=4.2" Flask_SQLAlchemy', ['pypi:django', 'pypi:flask-sqlalchemy']],
    ['python -m pip install -U pip "uvicorn[standard]"', ['pypi:pip', 'pypi:uvicorn']],
    ['python3.12 -m pip install --user httpx==0.27', ['pypi:httpx']],
    ['uv add fastapi pydantic-settings', ['pypi:fastapi', 'pypi:pydantic-settings']],
    ['uv pip install "numpy<2; python_version<\'3.13\'"', ['pypi:numpy']],
    ['uvx ruff check .', ['pypi:ruff!']],
    ['uv tool install black', ['pypi:black']],
    ['poetry add --group dev pytest', ['pypi:pytest']],
    ['pipx install httpie', ['pypi:httpie']],
    ['pipenv install requests', ['pypi:requests']],
    ['cargo add serde --features derive', ['crates:serde']],
    ['cargo add tokio@1 anyhow', ['crates:tokio', 'crates:anyhow']],
    ['cargo install ripgrep', ['crates:ripgrep']],
    ['gem install rails -v 7.1', ['rubygems:rails']],
    ['bundle add sidekiq', ['rubygems:sidekiq']],
    ['cd web && npm install axios && cd .. && pip install requests', ['npm:axios', 'pypi:requests']],
    ['sudo npm install -g npm-check-updates', ['npm:npm-check-updates']],
    ['CI=1 npm install left-pad', ['npm:left-pad']],
    ['npm install left-pad left-pad', ['npm:left-pad']],
  ]
  for (const [command, want] of cases) test(command, () => expect(names(command)).toEqual(want))
})

describe('leaves alone what is not a registry package', () => {
  const cases = [
    'npm install',
    'npm ci',
    'npm run build',
    'npm install ./packages/local',
    'npm install ../lib',
    'npm install file:../lib',
    'npm install git+https://github.com/a/b.git',
    'npm install github:user/repo',
    'npm install user/repo',
    'npm install https://example.com/pkg.tgz',
    'npm install ./pkg.tgz',
    'pnpm install',
    'yarn install',
    'yarn',
    'pip install -r requirements.txt',
    'pip install -e .',
    'pip install .',
    'pip install ./dist/pkg-1.0-py3-none-any.whl',
    'pip install git+https://github.com/a/b.git',
    'pip install "pkg @ https://example.com/pkg.zip"',
    'pip list',
    'cargo add --path ../core',
    'cargo add --git https://github.com/a/b',
    'cargo build',
    'gem install ./my.gem',
    'echo "npm install left-pad"',
    'git commit -m "pip install requests"',
  ]
  for (const command of cases) test(command, () => expect(names(command)).toEqual([]))
})

test('a command that names its own registry is not checked', () => {
  expect(parseInstalls('npm install --registry https://npm.corp.example internal-lib')).toEqual({ installs: [], hasCustomRegistry: true })
  expect(parseInstalls('pip install -i https://pypi.corp/simple tool').hasCustomRegistry).toBe(true)
  expect(parseInstalls('pip install --extra-index-url https://x/simple tool').hasCustomRegistry).toBe(true)
  // `gem install -i` is an install directory, not an index.
  expect(names('gem install -i vendor rails')).toEqual(['rubygems:rails'])
})

test('npmName strips versions and keeps scopes', () => {
  expect(npmName('@babel/core@7.24.0')).toBe('@babel/core')
  expect(npmName('Lodash@^4')).toBe('lodash')
  expect(npmName('@scope')).toBe(undefined)
  expect(npmName('workspace:*')).toBe(undefined)
})

test('pypiName normalizes per PEP 503', () => {
  expect(pypiName('Typing_Extensions>=4')).toBe('typing-extensions')
  expect(pypiName('zope.interface')).toBe('zope-interface')
  expect(pypiName('requests[socks,security]~=2.31')).toBe('requests')
})
