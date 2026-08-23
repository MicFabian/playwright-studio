const { notarize } = require('@electron/notarize');
const path = require('node:path');

/**
 * Notarization needs an Apple Developer account, so it is opt-in: without the
 * credentials this is a no-op and the build still produces a working, locally
 * signed app. See docs/signing.md for what to set.
 */
module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '  • skipping notarization  reason=APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID is not set',
    );
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`  • notarizing  file=${appPath} teamId=${teamId}`);

  await notarize({ appPath, appleId, appleIdPassword, teamId });

  console.log('  • notarized');
};
