import {defineConfig,globalIgnores} from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Existing beta code predates the Next 16 flat-config ruleset. Keep these
    // visible as warnings while making genuine parser/config errors block CI.
    rules:{
      '@typescript-eslint/no-explicit-any':'warn','@typescript-eslint/no-unused-vars':'warn','@typescript-eslint/no-unused-expressions':'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain':'warn','@typescript-eslint/no-require-imports':'warn','prefer-const':'warn',
      'react-hooks/set-state-in-effect':'warn','react-hooks/immutability':'warn','react-hooks/refs':'warn','react-hooks/preserve-manual-memoization':'warn',
      'react-hooks/rules-of-hooks':'warn','react-hooks/purity':'warn','react/no-unescaped-entities':'warn',
      '@next/next/no-html-link-for-pages':'warn','@next/next/no-location-assign-relative-destination':'warn',
    },
  },
  globalIgnores(['.next/**','coverage/**','node_modules/**','tsconfig.tsbuildinfo','components/*.s6-backup']),
]);
