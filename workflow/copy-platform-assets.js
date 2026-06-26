const fs = require('fs-extra');
const path = require('path');

const SRC_PLATFORMS_DIR = path.join(__dirname, '..', 'src', 'core', 'builder', 'platforms');
const DIST_PLATFORMS_DIR = path.join(__dirname, '..', 'dist', 'core', 'builder', 'platforms');

const COPY_ENTRIES = [
    'package.json',
    'static',
    'i18n',
    'docs',
    'scripts',
    'types',
    'readme.md',
    'README.md',
    'README.zh-cn.md',
    'tsconfig.json',
    'tsconfig.view.json'
];

async function copyPlatformAssets() {
    if (!fs.existsSync(SRC_PLATFORMS_DIR)) {
        return;
    }

    const platformNames = await fs.readdir(SRC_PLATFORMS_DIR);
    let copiedPlatforms = 0;

    for (const platformName of platformNames) {
        const platformRoot = path.join(SRC_PLATFORMS_DIR, platformName);
        const stat = await fs.stat(platformRoot).catch(() => null);
        if (!stat?.isDirectory()) {
            continue;
        }

        const packageJsonPath = path.join(platformRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            continue;
        }

        const distPlatformRoot = path.join(DIST_PLATFORMS_DIR, platformName);
        for (const entry of COPY_ENTRIES) {
            const source = path.join(platformRoot, entry);
            if (!fs.existsSync(source)) {
                continue;
            }
            await fs.copy(source, path.join(distPlatformRoot, entry), { overwrite: true });
        }
        copiedPlatforms++;
    }

    console.log(`Copied platform package assets: ${copiedPlatforms}`);
}

if (require.main === module) {
    copyPlatformAssets().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { copyPlatformAssets };
