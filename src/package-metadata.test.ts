import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageJson = {
  name?: string
  files?: string[]
  publishConfig?: {
    access?: string
  }
  scripts?: Record<string, string>
}

const readProjectFile = (filePath: string) => {
  return readFileSync(join(process.cwd(), filePath), 'utf8')
}

describe('package publishing metadata', () => {
  const packageJson = JSON.parse(readProjectFile('package.json')) as PackageJson

  it('publishes under the Injective Labs npm scope', () => {
    expect(packageJson.name).toBe('@injectivelabs/mcp-server-core')
  })

  it('publishes built artifacts as a public scoped package', () => {
    expect(packageJson.files).toContain('dist/')
    expect(packageJson.publishConfig?.access).toBe('public')
  })

  it('builds before packing instead of during consumer installation', () => {
    expect(packageJson.scripts?.prepack).toBe('npm run build')
    expect(packageJson.scripts).not.toHaveProperty('postinstall')
  })
})

describe('npm publish workflow', () => {
  const workflow = readProjectFile('.github/workflows/publish.yml')

  it('publishes public packages to the npm registry after verification', () => {
    const requiredSteps = [
      'registry-url: \'https://registry.npmjs.org\'',
      'npm ci',
      'npm test',
      'npm run typecheck',
      'npm run build',
      'npm publish --access public',
    ]

    for (const requiredStep of requiredSteps) {
      expect(workflow).toContain(requiredStep)
    }

    expect(workflow.indexOf('npm ci')).toBeLessThan(workflow.indexOf('npm test'))
    expect(workflow.indexOf('npm test')).toBeLessThan(workflow.indexOf('npm run typecheck'))
    expect(workflow.indexOf('npm run typecheck')).toBeLessThan(workflow.indexOf('npm run build'))
    expect(workflow.indexOf('npm run build')).toBeLessThan(workflow.indexOf('npm publish --access public'))
  })
})
