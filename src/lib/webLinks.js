/**
 * Host list for https links that open the app. Edit web-host.json only.
 * The first host is the public site. Later hosts are previous addresses that
 * should keep opening the app. Node only: app.config.js and the unit tests.
 */
const { hosts } = require('../../web-host.json');

const APP_LINK_PATH_PREFIXES = [
  '/search',
  '/location',
  '/auth',
  '/privacy',
  '/contact',
  '/profile',
  '/accounts',
  '/vehicles',
  '/shortcuts',
  '/notifications',
  '/sessions',
  '/reserve',
  '/chat',
  '/operator',
  '/staff',
  '/admin',
];

const OAUTH_CALLBACK_PATH = '/oauth-callback';

function assertWebHosts(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('web-host.json hosts must list at least one hostname');
  }
  for (const host of list) {
    if (typeof host !== 'string' || !host || host.includes('://') || host.includes('/')) {
      throw new Error('web-host.json hosts are names only, such as where-to-park.expo.app');
    }
  }
  return list;
}

const WEB_HOSTS = assertWebHosts(hosts);

function httpsLinkOpensApp(url, hostList = WEB_HOSTS) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || !hostList.includes(parsed.hostname)) return false;
  const path = parsed.pathname || '/';
  if (path === OAUTH_CALLBACK_PATH || path.startsWith(`${OAUTH_CALLBACK_PATH}/`)) return false;
  if (path === '/') return true;
  return APP_LINK_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function iosAssociatedDomains(hostList = WEB_HOSTS) {
  return hostList.map((host) => `applinks:${host}`);
}

function androidIntentFilters(hostList = WEB_HOSTS) {
  return [
    {
      action: 'VIEW',
      autoVerify: true,
      data: hostList.flatMap((host) => [
        { scheme: 'https', host, path: '/' },
        ...APP_LINK_PATH_PREFIXES.map((pathPrefix) => ({
          scheme: 'https',
          host,
          pathPrefix,
        })),
      ]),
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];
}

module.exports = {
  WEB_HOSTS,
  WEB_HOST: WEB_HOSTS[0],
  APP_LINK_PATH_PREFIXES,
  assertWebHosts,
  httpsLinkOpensApp,
  iosAssociatedDomains,
  androidIntentFilters,
};
