import * as fs from 'node:fs';
import * as pink from 'pink';
import * as path from 'node:path';

type Bundle = Record<string, unknown>;

type PreBuildHookFn = (
    options: Record<string, unknown>,
) => Promise<Record<string, unknown> | void>;

interface NativeEngineInfo {
    type?: string;
    path?: string;
}

interface HostContext {
    registerMethod(name: string, handler: (...args: any[]) => unknown | Promise<unknown>): void;
    registerPreBuildHook?(fn: PreBuildHookFn): void;
}

const PLATFORM = 'android';
const ANDROID_SDK_CONFIG_KEY = 'programManager.androidSDK';
const ANDROID_NDK_CONFIG_KEY = 'programManager.androidNDK';
const JAVA_HOME_CONFIG_KEY = 'programManager.javaHome';

interface AndroidPackage {
    sdkPath?: string;
    ndkPath?: string;
    javaHome?: string;
    javaPath?: string;
}

interface AndroidBuildOptions {
    packages?: {
        [PLATFORM]?: AndroidPackage;
    };
}

function currentLang(): 'zh' | 'en' {
    let locale = 'en';
    try {
        const cfg = process.env.VSCODE_NLS_CONFIG;
        if (cfg) {
            locale = (JSON.parse(cfg) as { locale?: string }).locale || locale;
        }
    } catch {
        // Fallback to English.
    }
    return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let cache: { lang: string; bundle: Bundle } | undefined;

function loadBundle(): Bundle {
    const lang = currentLang();
    if (cache?.lang === lang) {
        return cache.bundle;
    }

    let bundle: Bundle = {};
    try {
        const file = path.join(__dirname, '..', '..', 'i18n', `${lang}.js`);
        delete require.cache[require.resolve(file)];
        bundle = (require(file) as Bundle) ?? {};
    } catch {
        bundle = {};
    }
    cache = { lang, bundle };
    return bundle;
}

function lookup(bundle: Bundle, key: string): string | undefined {
    let cur: unknown = bundle;
    for (const seg of key.split('.')) {
        if (cur && typeof cur === 'object' && seg in (cur as Bundle)) {
            cur = (cur as Bundle)[seg];
        } else {
            return undefined;
        }
    }
    return typeof cur === 'string' ? cur : undefined;
}

function substitute(text: string, sub?: Record<string, unknown>): string {
    if (!sub) {
        return text;
    }
    return text.replace(/%?\{(\w+)\}/g, (match, key: string) => (key in sub ? String(sub[key]) : match));
}

function resolveExistingPathCase(filePath: string): string {
    if (!filePath || (process.platform !== 'win32' && process.platform !== 'darwin')) {
        return filePath;
    }

    const normalizedPath = path.normalize(filePath);
    const parsed = path.parse(normalizedPath);
    if (!parsed.root) {
        return normalizedPath;
    }

    const segments = normalizedPath.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
    let currentPath = parsed.root;

    for (const segment of segments) {
        let entries: string[];
        try {
            entries = fs.readdirSync(currentPath);
        } catch {
            return filePath;
        }

        const matched = entries.find((entry) => entry === segment)
            || entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
        if (!matched) {
            return filePath;
        }

        currentPath = path.join(currentPath, matched);
    }

    return currentPath;
}

function existsDir(filePath: string): boolean {
    try {
        return fs.statSync(resolveExistingPathCase(filePath)).isDirectory();
    } catch {
        return false;
    }
}

async function findSdkPath(): Promise<string> {
    return resolveExistingPathCase(await getConfigurationString(ANDROID_SDK_CONFIG_KEY));
}

async function getConfigurationString(key: string): Promise<string> {
    const value = await pink.configuration.get(key);
    return typeof value === 'string' ? value : '';
}

function resolveJavaPaths(javaHome: string): { javaHome: string; javaPath: string } {
    if (!javaHome) {
        return { javaHome: '', javaPath: '' };
    }

    const resolvedJavaHome = resolveExistingPathCase(javaHome);

    try {
        const st = fs.statSync(resolvedJavaHome);
        if (st.isFile()) {
            return {
                javaHome: path.normalize(path.join(path.dirname(resolvedJavaHome), '..')),
                javaPath: resolvedJavaHome,
            };
        }

        if (st.isDirectory()) {
            const javaFileName = process.platform === 'win32' ? 'java.exe' : 'java';
            const javaPath = resolveExistingPathCase(path.join(resolvedJavaHome, 'bin', javaFileName));
            if (fs.existsSync(javaPath)) {
                return { javaHome: resolvedJavaHome, javaPath };
            }
            console.error(`Java executable not found at ${resolvedJavaHome}/bin`);
        }
    } catch (error) {
        console.error(error);
    }

    return { javaHome: resolvedJavaHome, javaPath: '' };
}

async function createProgramPathPatch(pkg?: AndroidPackage): Promise<AndroidPackage> {
    const patch: AndroidPackage = {};

    if (pkg?.sdkPath) {
        const sdkPath = resolveExistingPathCase(pkg.sdkPath);
        if (sdkPath !== pkg.sdkPath) {
            patch.sdkPath = sdkPath;
        }
    } else {
        const sdkPath = resolveExistingPathCase(await getConfigurationString(ANDROID_SDK_CONFIG_KEY));
        if (sdkPath) {
            patch.sdkPath = sdkPath;
        }
    }

    if (pkg?.ndkPath) {
        const ndkPath = resolveExistingPathCase(pkg.ndkPath);
        if (ndkPath !== pkg.ndkPath) {
            patch.ndkPath = ndkPath;
        }
    } else {
        const ndkPath = resolveExistingPathCase(await getConfigurationString(ANDROID_NDK_CONFIG_KEY));
        if (ndkPath) {
            patch.ndkPath = ndkPath;
        }
    }

    const javaHomeSource = resolveExistingPathCase(pkg?.javaHome || (await getConfigurationString(JAVA_HOME_CONFIG_KEY)));
    if (javaHomeSource && javaHomeSource !== pkg?.javaHome) {
        patch.javaHome = javaHomeSource;
    }

    if (pkg?.javaPath) {
        const javaPath = resolveExistingPathCase(pkg.javaPath);
        if (javaPath !== pkg.javaPath) {
            patch.javaPath = javaPath;
        }
    } else if (javaHomeSource) {
        const javaPaths = resolveJavaPaths(javaHomeSource);
        if (!pkg?.javaHome && javaPaths.javaHome) {
            patch.javaHome = javaPaths.javaHome;
        } else if (pkg?.javaHome && javaPaths.javaHome !== pkg.javaHome) {
            patch.javaHome = javaPaths.javaHome;
        }
        if (javaPaths.javaPath) {
            patch.javaPath = javaPaths.javaPath;
        }
    }

    return patch;
}

function getAPILevel(apiLevelStr: string): number {
    const match = (apiLevelStr || '').match(/^android-([0-9]+)$/);
    return match ? Number.parseInt(match[1], 10) : -1;
}

async function getAndroidAPILevels(): Promise<number[]> {
    const sdkPath = await findSdkPath();
    if (!sdkPath) {
        return [];
    }

    const platformPath = resolveExistingPathCase(path.join(sdkPath, 'platforms'));
    if (!existsDir(platformPath)) {
        return [];
    }

    return fs.readdirSync(platformPath)
        .filter((name) => {
            const apiLevel = getAPILevel(name);
            return apiLevel >= 19 && existsDir(path.join(platformPath, name));
        })
        .map((name) => Number.parseInt(name.split('-')[1], 10))
        .sort((a, b) => b - a);
}

function getNativeEngineInfo(): NativeEngineInfo {
    try {
        const runtimeRequire = Function('return require')() as NodeRequire;
        const { Engine } = runtimeRequire(path.join(__dirname, '../../../../../engine'));
        return Engine.getInfo().native || {};
    } catch {
        return { type: 'builtin', path: '' };
    }
}

export function activate(context: HostContext): void {
    context.registerMethod('getI18nBundle', () => loadBundle());
    context.registerMethod('t', (key: string, sub?: Record<string, unknown>) => {
        const text = lookup(loadBundle(), key);
        return text === undefined ? key : substitute(text, sub);
    });
    context.registerMethod('getAndroidAPILevels', () => getAndroidAPILevels());
    context.registerMethod('getNativeEngineInfo', () => getNativeEngineInfo());
    context.registerMethod('openEngineSettings', async () => {
        try {
            const vscode = require('vscode') as typeof import('vscode');
            await vscode.commands.executeCommand('pinkSettings.start', { scope: 'global', nodeId: 'cocos.engine' });
            return true;
        } catch {
            return false;
        }
    });
    context.registerMethod('openProgramSettings', async () => {
        try {
            const vscode = require('vscode') as typeof import('vscode');
            await vscode.commands.executeCommand('pinkSettings.start', { scope: 'global', nodeId: 'pinkProgramManagerSettings' });
            return true;
        } catch {
            return false;
        }
    });

    context.registerPreBuildHook?.(async (options) => {
        const buildOptions = options as AndroidBuildOptions;
        const pkg = buildOptions.packages?.[PLATFORM];
        const patch = await createProgramPathPatch(pkg);

        if (Object.keys(patch).length) {
            return {
                packages: {
                    [PLATFORM]: patch,
                },
            };
        }
        return;
    });
}
