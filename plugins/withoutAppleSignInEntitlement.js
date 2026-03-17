const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * Removes the Sign In with Apple entitlement so the app builds with a free
 * personal Apple developer account. expo-apple-authentication must remain
 * installed to avoid native module crashes — this plugin just strips the
 * entitlement key that expo-apple-authentication's plugin adds.
 *
 * Must be listed BEFORE expo-apple-authentication in app.config.js so that
 * this mod is registered first and therefore executes last (each registered
 * mod wraps the previous one as its nextMod, so the last-registered runs
 * first and the first-registered runs last).
 */
const withoutAppleSignInEntitlement = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['com.apple.developer.applesignin'];
    return mod;
  });

module.exports = withoutAppleSignInEntitlement;
