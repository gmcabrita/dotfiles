#!/usr/bin/env node

const {
  CREDENTIALS_PATH,
  TOKEN_PATH,
  DEFAULT_SCOPES,
  authorize,
  clearToken,
  credentialsExist,
  formatScopes,
  getWorkspaceClientConfig,
  loadToken,
  resolveAuthMode,
} = require('./common');

function printHelp() {
  console.log(`Google Workspace auth helper

Usage:
  node scripts/auth.js login [--scopes scope1,scope2,...]
  node scripts/auth.js status
  node scripts/auth.js clear

Environment overrides:
  GOOGLE_WORKSPACE_CONFIG_DIR
  GOOGLE_WORKSPACE_CREDENTIALS
  GOOGLE_WORKSPACE_TOKEN
  GOOGLE_WORKSPACE_AUTH_MODE            (local|cloud)
  GOOGLE_WORKSPACE_CLIENT_ID            (cloud mode)
  GOOGLE_WORKSPACE_CLOUD_FUNCTION_URL   (cloud mode)
`);
}

function parseScopes(args) {
  const idx = args.indexOf('--scopes');
  if (idx === -1) {
    return DEFAULT_SCOPES;
  }
  const raw = args[idx + 1];
  if (!raw) {
    throw new Error('--scopes requires a value');
  }
  const scopes = formatScopes(raw);
  if (scopes.length === 0) {
    throw new Error('--scopes produced an empty scope list');
  }
  return scopes;
}

async function doLogin(args) {
  const scopes = parseScopes(args);
  await authorize({ scopes, interactive: true });
  console.log('✅ Login successful. Token stored at:');
  console.log(`   ${TOKEN_PATH}`);
}

function doStatus() {
  console.log('Credentials file:');
  console.log(`  ${CREDENTIALS_PATH}`);
  console.log(`  Exists: ${credentialsExist() ? 'yes' : 'no'}`);

  const token = loadToken();
  const mode = resolveAuthMode(token);
  const workspaceCfg = getWorkspaceClientConfig();

  console.log('\nAuth mode:');
  console.log(`  ${mode}`);
  if (mode === 'cloud') {
    const maskedClientId = workspaceCfg.clientId.replace(/^[^-]+/, '***');
    console.log(`  clientId: ${maskedClientId}`);
    console.log(`  cloudFunctionUrl: ${workspaceCfg.cloudFunctionUrl}`);
  }

  console.log('\nToken file:');
  console.log(`  ${TOKEN_PATH}`);
  console.log(`  Exists: ${token ? 'yes' : 'no'}`);

  if (!token) {
    return;
  }

  const now = Date.now();
  const expiry = token.expiry_date || null;
  const expired = expiry ? expiry < now : null;
  const scopeCount = formatScopes(token.scope).length;

  console.log('\nToken details:');
  console.log(`  access_token: ${token.access_token ? 'present' : 'missing'}`);
  console.log(`  refresh_token: ${token.refresh_token ? 'present' : 'missing'}`);
  console.log(`  scopes: ${scopeCount}`);

  if (expiry) {
    console.log(`  expiry_date: ${new Date(expiry).toISOString()}`);
    console.log(`  expired: ${expired ? 'yes' : 'no'}`);
  } else {
    console.log('  expiry_date: n/a');
  }
}

function doClear() {
  clearToken();
  console.log('✅ Token cleared.');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'login') {
    await doLogin(args);
    return;
  }

  if (command === 'status') {
    doStatus();
    return;
  }

  if (command === 'clear') {
    doClear();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
