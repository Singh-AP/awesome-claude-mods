// Pure verdicts from registry answers: no `$`, so tests can import it.

import type { Ecosystem } from './parse'

export type Status = 'ok' | 'missing' | 'suspicious' | 'unknown'

export type Verdict = {
  status: Status
  reasons: string[]
  createdAt?: string
  weeklyDownloads?: number
}

export type Limits = {
  minAgeDays: number
  minWeeklyDownloads: number
}

/** A registry's answer as `$.http.fetch` gives it, or undefined when there was none. */
export type Answer = { status: number; text: string } | undefined

export const REGISTRY_NAMES: Record<Ecosystem, string> = {
  npm: 'npm',
  pypi: 'PyPI',
  crates: 'crates.io',
  rubygems: 'RubyGems',
}

/** The URLs to ask about one package: its metadata, and its downloads where separate. */
export function urlsFor(ecosystem: Ecosystem, name: string): { meta: string; downloads?: string } {
  switch (ecosystem) {
    case 'npm':
      return {
        meta: `https://registry.npmjs.org/${name.replace('/', '%2F')}`,
        downloads: `https://api.npmjs.org/downloads/point/last-week/${name}`,
      }
    case 'pypi':
      return { meta: `https://pypi.org/pypi/${name}/json`, downloads: `https://pypistats.org/api/packages/${name}/recent` }
    case 'crates':
      return { meta: `https://crates.io/api/v1/crates/${name}` }
    case 'rubygems':
      return { meta: `https://rubygems.org/api/v1/gems/${name}.json` }
  }
}

const DAY = 24 * 60 * 60 * 1000

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const get = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), value)

/** When the package first appeared and how much it is used, per registry. */
function facts(ecosystem: Ecosystem, meta: Record<string, unknown>, downloads: Record<string, unknown> | undefined): { createdAt?: string; weeklyDownloads?: number } {
  // npm and PyPI keep downloads apart (weeklyFrom); crates.io and RubyGems carry them here.
  switch (ecosystem) {
    case 'npm': {
      const created = get(meta, 'time', 'created')
      const weekly = get(downloads, 'downloads')
      return { createdAt: typeof created === 'string' ? created : undefined, weeklyDownloads: typeof weekly === 'number' ? weekly : undefined }
    }
    case 'pypi': {
      // The earliest upload of any release is when the name was first used.
      const releases = get(meta, 'releases')
      let first: string | undefined
      if (releases !== null && typeof releases === 'object') {
        for (const files of Object.values(releases as Record<string, unknown>)) {
          if (!Array.isArray(files)) continue
          for (const file of files) {
            const at = get(file, 'upload_time_iso_8601') ?? get(file, 'upload_time')
            if (typeof at === 'string' && (first === undefined || at < first)) first = at
          }
        }
      }
      const weekly = get(downloads, 'data', 'last_week')
      return { createdAt: first, weeklyDownloads: typeof weekly === 'number' ? weekly : undefined }
    }
    case 'crates': {
      const created = get(meta, 'crate', 'created_at')
      const recent = get(meta, 'crate', 'recent_downloads')
      return {
        createdAt: typeof created === 'string' ? created : undefined,
        weeklyDownloads: typeof recent === 'number' ? Math.round(recent / 13) : undefined,
      }
    }
    case 'rubygems': {
      // RubyGems reports lifetime downloads only; a year's worth stands in for a week's floor.
      const total = get(meta, 'downloads')
      return { weeklyDownloads: typeof total === 'number' ? Math.round(total / 52) : undefined }
    }
  }
}

/** What the registries answered about one package; `meta` is left out when not needed. */
export type Answers = {
  /** Whether the name exists: a HEAD of the metadata URL, or the metadata itself. */
  exists: Answer
  meta?: Answer
  downloads?: Answer
}

/** Weekly downloads from a downloads answer, where the registry keeps them apart. */
export function weeklyFrom(ecosystem: Ecosystem, downloads: Answer): number | undefined {
  if (downloads === undefined || downloads.status !== 200) return undefined
  const body = parse(downloads.text)
  const value = ecosystem === 'npm' ? get(body, 'downloads') : get(body, 'data', 'last_week')
  return typeof value === 'number' ? value : undefined
}

/** Whether a package this used needs no closer look at its metadata. */
export const isPopular = (weekly: number | undefined): boolean => weekly !== undefined && weekly >= 10_000

/**
 * The verdict on one package from its registry's answers. A 404 means the
 * name was never published; any other failure is `unknown`, never a block.
 */
export function judge(ecosystem: Ecosystem, name: string, answers: Answers, now: number, limits: Limits): Verdict {
  const { exists } = answers
  const registry = REGISTRY_NAMES[ecosystem]
  if (exists === undefined) return { status: 'unknown', reasons: [`${registry} did not answer`] }
  if (exists.status === 404) return { status: 'missing', reasons: [`no package named "${name}" exists on ${registry}`] }
  if (exists.status < 200 || exists.status >= 300) return { status: 'unknown', reasons: [`${registry} answered ${exists.status}`] }

  const meta = answers.meta !== undefined && answers.meta.status >= 200 && answers.meta.status < 300 ? parse(answers.meta.text) : undefined
  // npm keeps a stub for unpublished names: it has no versions left.
  if (ecosystem === 'npm' && meta !== undefined && get(meta, 'versions') === undefined && get(meta, 'time', 'unpublished') !== undefined) {
    return { status: 'missing', reasons: [`"${name}" was unpublished from npm`] }
  }

  const known = meta === undefined ? {} : facts(ecosystem, meta, undefined)
  const weeklyDownloads = weeklyFrom(ecosystem, answers.downloads) ?? known.weeklyDownloads
  const reasons: string[] = []
  if (known.createdAt !== undefined) {
    const ageDays = Math.floor((now - Date.parse(known.createdAt)) / DAY)
    if (Number.isFinite(ageDays) && ageDays < limits.minAgeDays) reasons.push(`it was first published ${ageDays <= 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}`)
  }
  if (weeklyDownloads !== undefined && weeklyDownloads < limits.minWeeklyDownloads) {
    reasons.push(`it has only ${weeklyDownloads} downloads a week`)
  }
  const twin = isPopular(weeklyDownloads) ? undefined : lookalike(ecosystem, name)
  if (twin !== undefined) reasons.push(`its name is one letter away from the popular "${twin}"`)

  return { status: reasons.length > 0 ? 'suspicious' : 'ok', reasons, createdAt: known.createdAt, weeklyDownloads }
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
export function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1)
      d[i]![j] = best
    }
  }
  return d[a.length]![b.length]!
}

/** The popular package `name` is a near miss of, if any (and `name` is not itself one). */
export function lookalike(ecosystem: Ecosystem, name: string): string | undefined {
  const list = POPULAR[ecosystem]
  const plain = name.replace(/^@[^/]+\//, '')
  if (list.includes(plain) || plain.length < 4) return undefined
  return list.find(popular => popular.length >= 4 && Math.abs(popular.length - plain.length) <= 1 && distance(popular, plain) === 1)
}

// Widely used names, the ones typosquatters aim at.
export const POPULAR: Record<Ecosystem, readonly string[]> = {
  npm: [
    'react', 'react-dom', 'lodash', 'express', 'axios', 'typescript', 'next', 'webpack', 'chalk', 'commander',
    'moment', 'dayjs', 'uuid', 'debug', 'request', 'async', 'bluebird', 'underscore', 'jquery', 'eslint',
    'prettier', 'jest', 'mocha', 'chai', 'yargs', 'inquirer', 'dotenv', 'cors', 'body-parser', 'mongoose',
    'mysql', 'mysql2', 'redis', 'ioredis', 'socket.io', 'node-fetch', 'cross-env', 'rimraf', 'glob', 'minimist',
    'semver', 'fs-extra', 'mkdirp', 'classnames', 'prop-types', 'redux', 'react-redux', 'react-router', 'react-router-dom', 'styled-components',
    'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'vite', 'rollup', 'esbuild', 'nodemon', 'ts-node', 'zod',
    'jsonwebtoken', 'bcrypt', 'bcryptjs', 'passport', 'sequelize', 'prisma', 'knex', 'graphql', 'firebase', 'aws-sdk',
    'stripe', 'twilio', 'nodemailer', 'sharp', 'multer', 'cheerio', 'puppeteer', 'playwright', 'electron', 'three',
    'chart.js', 'rxjs', 'immer', 'formik', 'svelte', 'nuxt', 'gatsby', 'husky', 'lint-staged', 'concurrently',
    'colors', 'boxen', 'figlet', 'marked', 'highlight.js', 'date-fns', 'luxon', 'superagent', 'form-data', 'cookie-parser',
    'express-session', 'helmet', 'morgan', 'winston', 'pino', 'openai', 'langchain', 'vitest', 'webpack-cli', 'babel-loader',
  ],
  pypi: [
    'requests', 'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'tensorflow', 'torch', 'keras',
    'flask', 'django', 'fastapi', 'uvicorn', 'gunicorn', 'pydantic', 'sqlalchemy', 'psycopg2', 'psycopg2-binary', 'pymysql',
    'redis', 'celery', 'boto3', 'botocore', 'awscli', 'urllib3', 'certifi', 'idna', 'charset-normalizer', 'setuptools',
    'wheel', 'python-dateutil', 'pytz', 'pyyaml', 'jinja2', 'markupsafe', 'click', 'rich', 'typer', 'tqdm',
    'pillow', 'opencv-python', 'beautifulsoup4', 'lxml', 'selenium', 'scrapy', 'httpx', 'aiohttp', 'attrs', 'cryptography',
    'pyjwt', 'paramiko', 'pytest', 'coverage', 'black', 'flake8', 'mypy', 'pylint', 'isort', 'ruff',
    'poetry', 'openai', 'anthropic', 'langchain', 'transformers', 'datasets', 'huggingface-hub', 'tokenizers', 'sentencepiece', 'nltk',
    'spacy', 'gensim', 'xgboost', 'lightgbm', 'catboost', 'plotly', 'streamlit', 'gradio', 'jupyter', 'notebook',
    'ipython', 'ipykernel', 'networkx', 'sympy', 'statsmodels', 'pyarrow', 'polars', 'dask', 'protobuf', 'grpcio',
    'pymongo', 'elasticsearch', 'kafka-python', 'docker', 'kubernetes', 'ansible', 'python-dotenv', 'colorama', 'termcolor', 'tabulate',
    'packaging', 'filelock', 'platformdirs', 'virtualenv', 'websockets', 'marshmallow', 'alembic', 'werkzeug', 'simplejson', 'orjson',
  ],
  crates: [
    'serde', 'serde_json', 'tokio', 'rand', 'clap', 'anyhow', 'thiserror', 'reqwest', 'regex', 'chrono',
    'log', 'env_logger', 'tracing', 'futures', 'hyper', 'axum', 'actix-web', 'syn', 'quote', 'itertools',
    'once_cell', 'lazy_static', 'bytes', 'uuid', 'sqlx', 'diesel', 'rayon', 'crossbeam', 'parking_lot', 'base64',
  ],
  rubygems: [
    'rails', 'rake', 'rack', 'bundler', 'rspec', 'nokogiri', 'devise', 'puma', 'sidekiq', 'pg',
    'activesupport', 'activerecord', 'json', 'thor', 'faraday', 'httparty', 'rubocop', 'pry', 'sinatra', 'capybara',
  ],
}
