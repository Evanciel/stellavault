import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Stellavault',
    executableName: 'stellavault',
    asar: true,
    icon: './assets/icon',
  },
  makers: [
    new MakerSquirrel({ name: 'stellavault', authors: 'Evanciel', description: 'Stellavault Desktop' }),
    new MakerZIP({}, ['win32', 'darwin', 'linux']),
    new MakerDeb({ options: { name: 'stellavault', productName: 'Stellavault' } }),
    new MakerDMG({ name: 'Stellavault' }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
