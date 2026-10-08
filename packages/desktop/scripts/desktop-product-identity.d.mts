export type DesktopProductFlavor = "production" | "preview";
export type DesktopIdentityEnv = Record<string, string | undefined>;

export interface DesktopProductIdentity {
  readonly flavor: DesktopProductFlavor;
  readonly appId: string;
  readonly productName: string;
  readonly userDataDirectoryName: string;
  readonly linuxExecutableName: string;
  readonly linuxPackageName: string;
  readonly cuaHelperInstallVariant: "preview" | null;
}

export const ZCODE_PREVIEW_IDENTITY_ENV: "ZCODE_PREVIEW_IDENTITY";
export const desktopProductIdentities: Readonly<
  Record<DesktopProductFlavor, DesktopProductIdentity>
>;

export function resolveDesktopRuntimeIdentity(options: {
  isPackaged: boolean;
  flavor: string;
  applicationName?: string;
}): { applicationName: string; userDataDirectoryName: string };

export function isPreviewIdentityRequested(env?: DesktopIdentityEnv): boolean;
export function resolveDesktopProductFlavor(env?: DesktopIdentityEnv): DesktopProductFlavor;
export function resolveDesktopProductIdentity(env?: DesktopIdentityEnv): DesktopProductIdentity;
export function resolveDesktopArtifactSuffix(env?: DesktopIdentityEnv): "_TEST" | "";
export function resolveWindowsAppUserModelIdForFlavor(
  flavor: string,
  runtime?: { isPackaged: boolean },
): string;
export function resolveWindowsAppUserModelId(
  env?: DesktopIdentityEnv,
  runtime?: { isPackaged: boolean },
): string;
