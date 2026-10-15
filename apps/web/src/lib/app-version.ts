import pkg from "../../package.json";

/** The web app's version, sent with problem reports. NEXT_PUBLIC_APP_VERSION (a release tag or commit) wins when set at build time. */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version;
