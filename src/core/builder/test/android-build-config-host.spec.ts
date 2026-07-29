import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockConfigurationGet = jest.fn();

jest.mock('pink', () => ({
    configuration: {
        get: mockConfigurationGet,
    },
}), { virtual: true });

import { activate } from '../platforms/android/src/view/build-config-host';

type HostMethods = Record<string, (...args: any[]) => unknown>;

function createHostMethods(): HostMethods {
    const methods: HostMethods = {};
    activate({
        registerMethod(name, handler) {
            methods[name] = handler;
        },
    });
    return methods;
}

function usePlatform(platform: NodeJS.Platform): () => void {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
        ...descriptor,
        value: platform,
        configurable: true,
    });

    return () => {
        if (descriptor) {
            Object.defineProperty(process, 'platform', descriptor);
        }
    };
}

function differentCase(filePath: string): string {
    const upper = filePath.toUpperCase();
    return upper === filePath ? filePath.toLowerCase() : upper;
}

describe('android build-config host', () => {
    let tempDir = '';

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'cocos-cli-android-sdk-'));
        mockConfigurationGet.mockReset();
    });

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
            tempDir = '';
        }
    });

    it('reads Android API levels from configured SDK path with mismatched casing on macOS-like file systems', async () => {
        const restorePlatform = usePlatform('darwin');
        try {
            const sdkPath = join(tempDir, 'Android', 'Sdk');
            mkdirSync(join(sdkPath, 'platforms', 'android-34'), { recursive: true });
            mkdirSync(join(sdkPath, 'platforms', 'android-21'), { recursive: true });
            mkdirSync(join(sdkPath, 'platforms', 'android-18'), { recursive: true });
            mkdirSync(join(sdkPath, 'platforms', 'not-android'), { recursive: true });
            mockConfigurationGet.mockImplementation(async (key: string) => {
                return key === 'programManager.androidSDK' ? differentCase(sdkPath) : '';
            });

            const methods = createHostMethods();
            const levels = await Promise.resolve(methods.getAndroidAPILevels());

            expect(levels).toEqual([34, 21]);
        } finally {
            restorePlatform();
        }
    });
});
