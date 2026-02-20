#!/usr/bin/env node

const {
  DEFAULT_VERSIONS,
  authorize,
  formatScopes,
  getGoogleApis,
} = require('./common');

function printHelp() {
  console.log(`Google Workspace API helper

Usage:
  node scripts/workspace.js call <service> <method.path> [params-json] [--version vX] [--scopes s1,s2]
  node scripts/workspace.js calendar-today [calendarId]
  node scripts/workspace.js drive-search <query>
  node scripts/workspace.js gmail-search <query>

Examples:
  node scripts/workspace.js call drive files.list '{"pageSize":5,"fields":"files(id,name)"}'
  node scripts/workspace.js call calendar events.list '{"calendarId":"primary","maxResults":10,"singleEvents":true,"orderBy":"startTime"}'
  node scripts/workspace.js drive-search "name contains 'Roadmap' and trashed=false"
  node scripts/workspace.js gmail-search "from:alice@example.com newer_than:7d"
`);
}

function parseOptions(argv) {
  const positional = [];
  const options = {
    version: undefined,
    scopes: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') {
      options.version = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--scopes') {
      options.scopes = formatScopes(argv[i + 1]);
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  return { positional, options };
}

function resolveMethod(root, methodPath) {
  const parts = methodPath.split('.').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('method.path is empty');
  }

  let parent = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    parent = parent?.[parts[i]];
    if (!parent) {
      throw new Error(`Invalid method path (missing segment: ${parts[i]})`);
    }
  }

  const methodName = parts[parts.length - 1];
  const method = parent?.[methodName];

  if (typeof method !== 'function') {
    throw new Error(
      `Invalid method path: ${methodPath}. Final segment is not callable.`,
    );
  }

  return { parent, method };
}

function parseJsonObject(raw, label) {
  if (!raw) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed;
}

async function callApi({ service, methodPath, params, version, scopes }) {
  const google = getGoogleApis();
  const factory = google[service];
  if (typeof factory !== 'function') {
    throw new Error(`Unknown Google API service: ${service}`);
  }

  const auth = await authorize({
    interactive: true,
    scopes: scopes && scopes.length > 0 ? scopes : undefined,
  });

  const api = factory({
    version: version || DEFAULT_VERSIONS[service] || 'v1',
    auth,
  });

  const { parent, method } = resolveMethod(api, methodPath);
  const response = await method.call(parent, params);
  return response?.data ?? response;
}

async function cmdCall(args, options) {
  const [service, methodPath, paramsRaw] = args;

  if (!service || !methodPath) {
    throw new Error('Usage: call <service> <method.path> [params-json]');
  }

  const params = parseJsonObject(paramsRaw, 'params-json');
  const data = await callApi({
    service,
    methodPath,
    params,
    version: options.version,
    scopes: options.scopes,
  });

  console.log(JSON.stringify(data, null, 2));
}

async function cmdCalendarToday(args, options) {
  const calendarId = args[0] || 'primary';

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const data = await callApi({
    service: 'calendar',
    methodPath: 'events.list',
    version: options.version,
    scopes: options.scopes,
    params: {
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    },
  });

  console.log(JSON.stringify(data, null, 2));
}

async function cmdDriveSearch(args, options) {
  const query = args.join(' ').trim();
  if (!query) {
    throw new Error('Usage: drive-search <query>');
  }

  const data = await callApi({
    service: 'drive',
    methodPath: 'files.list',
    version: options.version,
    scopes: options.scopes,
    params: {
      q: query,
      pageSize: 20,
      fields:
        'nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink)',
    },
  });

  console.log(JSON.stringify(data, null, 2));
}

async function cmdGmailSearch(args, options) {
  const query = args.join(' ').trim();
  if (!query) {
    throw new Error('Usage: gmail-search <query>');
  }

  const list = await callApi({
    service: 'gmail',
    methodPath: 'users.messages.list',
    version: options.version,
    scopes: options.scopes,
    params: {
      userId: 'me',
      q: query,
      maxResults: 20,
    },
  });

  const messages = list.messages || [];
  const details = [];

  for (const message of messages.slice(0, 10)) {
    const full = await callApi({
      service: 'gmail',
      methodPath: 'users.messages.get',
      version: options.version,
      scopes: options.scopes,
      params: {
        userId: 'me',
        id: message.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      },
    });

    details.push({
      id: message.id,
      threadId: message.threadId,
      snippet: full.snippet,
      payload: full.payload,
    });
  }

  console.log(
    JSON.stringify(
      {
        resultCount: messages.length,
        messages: details,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const { positional, options } = parseOptions(process.argv.slice(2));
  const [command, ...args] = positional;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'call') {
    await cmdCall(args, options);
    return;
  }

  if (command === 'calendar-today') {
    await cmdCalendarToday(args, options);
    return;
  }

  if (command === 'drive-search') {
    await cmdDriveSearch(args, options);
    return;
  }

  if (command === 'gmail-search') {
    await cmdGmailSearch(args, options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
