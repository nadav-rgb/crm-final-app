import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => readFile(path.join(root, file), 'utf8');

test('Android application disables backup, cleartext and external deep-link entry points', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.doesNotMatch(manifest, /android\.intent\.action\.VIEW|android\.intent\.category\.BROWSABLE/);
});

test('Android network policy trusts system HTTPS roots and never permits cleartext', async () => {
  const policy = await read('android/app/src/main/res/xml/network_security_config.xml');
  assert.match(policy, /<base-config\s+cleartextTrafficPermitted="false">/);
  assert.match(policy, /<certificates\s+src="system"\s*\/>/);
  assert.match(policy, /<domain\s+includeSubdomains="false">crm-final-app\.vercel\.app<\/domain>/);
  assert.doesNotMatch(policy, /src="user"|cleartextTrafficPermitted="true"/);
});

test('FileProvider exposes only the dedicated cache export directory', async () => {
  const paths = await read('android/app/src/main/res/xml/file_paths.xml');
  assert.match(paths, /<cache-path\s+name="secure_exports"\s+path="exports\/"\s*\/>/);
  assert.doesNotMatch(paths, /<(?:external|external-files|external-cache|root|files)-path\b/);
  assert.equal((paths.match(/<[a-z-]+path\b/g) ?? []).length, 1);
});

test('release build is minified and cannot fall back to debug signing', async () => {
  const gradle = await read('android/app/build.gradle');
  assert.match(gradle, /releaseBuildRequested/);
  assert.match(gradle, /throw new GradleException\("Release signing configuration missing/);
  assert.match(gradle, /minifyEnabled true/);
  assert.match(gradle, /shrinkResources true/);
  assert.match(gradle, /proguard-android-optimize\.txt/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug|signingConfig\s+.*\?.*debug/);
});

test('R8 preserves only required native bridge metadata and runs in full mode', async () => {
  const rules = await read('android/app/proguard-rules.pro');
  const properties = await read('android/gradle.properties');
  assert.match(rules, /RuntimeVisibleAnnotations/);
  assert.match(rules, /com\.getcapacitor\.annotation\.CapacitorPlugin/);
  assert.match(rules, /com\.google\.firebase\.messaging/);
  assert.match(properties, /^android\.enableR8\.fullMode=true$/m);
});

test('native activity prevents capture and hardens the remote WebView boundary', async () => {
  const activity = await read('android/app/src/main/java/com/achdutyehudit/crm/MainActivity.java');
  assert.match(activity, /WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity, /setAllowFileAccess\(false\)/);
  assert.match(activity, /setAllowContentAccess\(false\)/);

  const config = JSON.parse(await read('capacitor.config.json'));
  const server = new URL(config.server.url);
  assert.equal(server.protocol, 'https:');
  assert.equal(server.hostname, 'crm-final-app.vercel.app');
  assert.equal(config.server.cleartext, false);
});
