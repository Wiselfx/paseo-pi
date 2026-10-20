export const PI_PLUGIN_ID = "paseo-pi";
/** Paseo's built-in pi provider, which owns pi sessions. */
export const PI_BUILTIN_PROVIDER_ID = "pi";
/** The plugin's legacy provider. Kept for agents created before the management-only change. */
export const PI_PROVIDER_ID = "pi-plugin";
export const PI_PROVIDER_LABEL = "Pi Plugin";
export const PI_PROVIDER_DESCRIPTION =
  "Runs the pi coding agent on the daemon host as a first-class Paseo provider.";
export const PI_SETTINGS_SCREEN_ID = "pi-config";
export const PI_PERSISTENCE_VERSION = 1;
export const PI_LAUNCH_SETTINGS_ID = "paseo-pi-launch";
/** Installed in pi's extensions directory so built-in pi sessions get /reload. */
export const PI_RELOAD_EXTENSION_FILE = "paseo-pi-reload.ts";
