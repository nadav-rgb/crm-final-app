import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function declarations(css) {
  return new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2]]));
}

function assertVariableResolves(name, variables, stack = new Set()) {
  assert.equal(variables.has(name), true, `${name} must be defined by imported CSS`);
  assert.equal(stack.has(name), false, `${name} must not contain a token cycle`);
  const nextStack = new Set(stack).add(name);
  for (const reference of variables.get(name).matchAll(/var\((--[\w-]+)\)/g)) {
    assertVariableResolves(reference[1], variables, nextStack);
  }
}

test('trusted standard 500 component bypasses providers before hydration', async () => {
  const [app, page] = await Promise.all([source('pages/_app.jsx'), source('pages/500.jsx')]);
  const bypass = 'Component.isPublicErrorPage === true';
  const bypassIndex = app.indexOf(bypass);
  const providerIndex = app.indexOf('<AuthProvider>');

  assert.notEqual(bypassIndex, -1, 'App must recognize the trusted component marker');
  assert.notEqual(providerIndex, -1, 'AuthProvider contract unexpectedly disappeared');
  assert.equal(bypassIndex < providerIndex, true, 'error-page bypass must run before providers mount');
  assert.match(app, /if \(Component\.isPublicErrorPage === true\) return <Component \{\.\.\.pageProps\} \/>;/);
  assert.match(page, /ServerErrorPage\.isPublicErrorPage\s*=\s*true/);
  assert.doesNotMatch(app, /router\.pathname\s*===\s*['"]\/500['"]/);
  assert.match(page, />\s*500\s*</);
  assert.match(page, /משהו השתבש/);
  assert.doesNotMatch(page, /AuthProvider|LoginPage|CrmProvider|fetch\(|useEffect|useRouter/);
});

test('standard 500 page consumes only resolvable imported tokens and stable RTL styles', async () => {
  const [page, moduleCss, globals] = await Promise.all([
    source('pages/500.jsx'),
    source('styles/error-page.module.css'),
    source('styles/globals.css'),
  ]);
  const variables = new Map([...declarations(globals), ...declarations(moduleCss)]);

  assert.match(page, /import styles from ['"]\.\.\/styles\/error-page\.module\.css['"]/);
  assert.doesNotMatch(page, /style=\{\{/);
  assert.doesNotMatch(page, /<(?:button|a|input|select|textarea)\b/);
  assert.doesNotMatch(moduleCss, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.match(moduleCss, /direction:\s*rtl/);
  assert.match(moduleCss, /letter-spacing:\s*0/);
  assert.match(moduleCss, /--error-body-size:\s*1rem/);
  assert.match(moduleCss, /font-size:\s*var\(--error-body-size\)/);
  assert.match(moduleCss, /(?:padding|margin|inset|border)-(?:inline|block)/);

  for (const reference of moduleCss.matchAll(/var\((--[\w-]+)\)/g)) {
    assertVariableResolves(reference[1], variables);
  }
});
